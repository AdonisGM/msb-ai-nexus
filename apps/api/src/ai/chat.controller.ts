import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Response } from 'express'
import { STORAGE_ENABLED } from '../env'
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { AI_ENABLED } from './claude'
import { MAX_UPLOAD_BYTES, type UploadedFile as UploadedFileBody } from './attachments.service'
import { ChatService, type ChatEvent } from './chat.service'
import { DecideToolCallDto, SendMessageDto, StartConversationDto } from './dto'

/** The assistant, one thread at a time.
 *
 *  No `@Roles`: every role may ask, and what each of them gets back is decided
 *  by the scope on the tools rather than by a gate here. A salesperson asking
 *  "how is the branch doing" gets their own book, not a refusal — which is the
 *  honest answer to what they are allowed to know. */
@Controller('chat')
@UseGuards(AuthGuard, RolesGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  /** Whether the assistant is configured at all.
   *
   *  Its own endpoint so the web can hide the tab rather than offering one
   *  that answers 503 — a demo machine with no key should look like a product
   *  without the feature, not like a product that is broken. */
  @Get('status')
  status() {
    return { enabled: AI_ENABLED, attachments: AI_ENABLED && STORAGE_ENABLED }
  }

  @Get()
  list(@Req() req: AuthedRequest) {
    return this.chat.list(req.user!)
  }

  @Post()
  start(@Req() req: AuthedRequest, @Body() body: StartConversationDto) {
    return this.chat.start(req.user!, body)
  }

  @Get(':id')
  get(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.chat.get(req.user!, id)
  }

  /** Answers with the whole thread rather than just the new turns: the loop
   *  can produce several messages and a handful of tool calls, and reassembling
   *  them in the browser is a second place for the order to go wrong. */
  @Post(':id/messages')
  @HttpCode(200)
  send(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: SendMessageDto) {
    return this.chat.send(req.user!, id, body)
  }

  /** Takes one file for the thread's next message and answers with the
   *  reference the message will carry.
   *
   *  Separate from sending, so a photo uploads while the person is still
   *  typing about it, and so the send itself stays a small JSON body. Held in
   *  memory rather than on disk: the cap is ten megabytes, and the bytes go
   *  straight on to storage.
   *
   *  `defParamCharset` because multipart filenames are decoded as Latin-1
   *  otherwise, and "Hợp đồng.pdf" arrives as mojibake. */
  @Post(':id/attachments')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
      defParamCharset: 'utf8',
    }),
  )
  upload(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @UploadedFile() file: UploadedFileBody | undefined,
  ) {
    if (!file) throw new BadRequestException('attachment_required')
    return this.chat.upload(req.user!, id, file)
  }

  /** A file back, for the chip and the preview.
   *
   *  Served with the type decided at upload, never the one the browser sent,
   *  and `nosniff` from helmet, so a text file that happens to contain markup
   *  is shown as text and never run as a page. */
  @Get(':id/attachments/:attachmentId')
  async attachment(
    @Req() req: AuthedRequest,
    @Res() res: Response,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    const { row, bytes } = await this.chat.download(req.user!, id, attachmentId)

    res.setHeader(
      'content-type',
      row.kind === 'text' ? 'text/plain; charset=utf-8' : row.mime,
    )
    res.setHeader('content-length', String(bytes.length))
    res.setHeader('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(row.filename)}`)
    /** Private: it is somebody's file behind their session, and no proxy in
     *  between has any business keeping a copy. */
    res.setHeader('cache-control', 'private, max-age=3600')
    res.end(bytes)
  }

  /** Two endpoints rather than one with a boolean, so what a request does is
   *  readable in a log. The row is checked against the thread and the thread
   *  against its owner, so neither can be pressed from outside. */
  @Post(':id/tool-calls/:callId/approve')
  @HttpCode(200)
  approve(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('callId') callId: string,
    @Body() body: DecideToolCallDto,
  ) {
    return this.chat.decide(req.user!, id, callId, true, body.note)
  }

  @Post(':id/tool-calls/:callId/deny')
  @HttpCode(200)
  deny(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('callId') callId: string,
    @Body() body: DecideToolCallDto,
  ) {
    return this.chat.decide(req.user!, id, callId, false, body.note)
  }

  /** The same turn, streamed.
   *
   *  A tool loop takes ten to fifteen seconds, and the non-streaming endpoint
   *  spends all of it silent. This one sends the words as the model writes
   *  them and names each tool as it is reached, so the wait has something in
   *  it — which is the difference between "thinking" and "broken".
   *
   *  Written to the response by hand rather than through Nest's `@Sse()`,
   *  which builds a GET endpoint from an Observable. This has to be a POST:
   *  the message is a body, not a query string, and a question typed by a
   *  person has no business in a URL that ends up in a log. */
  @Post(':id/messages/stream')
  async stream(
    @Req() req: AuthedRequest,
    @Res() res: Response,
    @Param('id') id: string,
    @Body() body: SendMessageDto,
  ) {
    openStream(res)

    const emit = (event: ChatEvent) => write(res, event)

    try {
      await this.chat.send(req.user!, id, body, emit)
      write(res, { kind: 'done' })
    } catch (error) {
      /** The headers went out with the first byte, so a thrown error can no
       *  longer become a status code. It goes down the stream as an event and
       *  the screen shows it in place of the answer. */
      write(res, { kind: 'error', message: messageOf(error) })
    } finally {
      res.end()
    }
  }

  @Post(':id/tool-calls/:callId/approve/stream')
  async approveStream(
    @Req() req: AuthedRequest,
    @Res() res: Response,
    @Param('id') id: string,
    @Param('callId') callId: string,
    @Body() body: DecideToolCallDto,
  ) {
    openStream(res)

    try {
      await this.chat.decide(req.user!, id, callId, true, body.note, (event) => write(res, event))
      write(res, { kind: 'done' })
    } catch (error) {
      write(res, { kind: 'error', message: messageOf(error) })
    } finally {
      res.end()
    }
  }

  @Post(':id/tool-calls/:callId/deny/stream')
  async denyStream(
    @Req() req: AuthedRequest,
    @Res() res: Response,
    @Param('id') id: string,
    @Param('callId') callId: string,
    @Body() body: DecideToolCallDto,
  ) {
    openStream(res)

    try {
      await this.chat.decide(req.user!, id, callId, false, body.note, (event) =>
        write(res, event),
      )
      write(res, { kind: 'done' })
    } catch (error) {
      write(res, { kind: 'error', message: messageOf(error) })
    } finally {
      res.end()
    }
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.chat.remove(req.user!, id)
  }
}

/** Opens the response as an event stream.
 *
 *  `X-Accel-Buffering: no` is for nginx, which otherwise holds the whole
 *  response until it is complete — turning a stream back into the fifteen
 *  seconds of silence it was built to remove, and only in production, where
 *  nobody is watching a dev server. */
function openStream(res: Response) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  res.flushHeaders?.()
}

/** One SSE frame. JSON on a single line, because a newline inside the payload
 *  would end the frame early — which `JSON.stringify` guarantees it cannot. */
function write(res: Response, event: ChatEvent) {
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}

function messageOf(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const body = (error as { response?: { message?: unknown } }).response
    if (typeof body?.message === 'string') return body.message
  }
  return error instanceof Error ? error.message : 'unexpected_error'
}
