import { createHash, randomUUID } from 'node:crypto'
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common'
import type Anthropic from '@anthropic-ai/sdk'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { DB, type Db } from '../db/db.module'
import { attachments, type Attachment, type Conversation, type User } from '../db/schema'
import { OBJECT_STORE, type ObjectStore } from '../storage/object-store'

type Block = Anthropic.Beta.Messages.BetaContentBlockParam

export type AttachmentKind = 'image' | 'pdf' | 'text'

/** How a file sits inside a stored turn.
 *
 *  Not an Anthropic block — the one thing in `messages.content` that is not.
 *  The bytes are swapped in on the way to the model (see `replay.ts`) and only
 *  for the last few turns, so a thread with a PDF in it does not pay for that
 *  PDF on every question that follows. The name and kind ride along so the
 *  screen can draw the chip without a second request. */
export type AttachmentRef = {
  type: 'attachment'
  id: string
  kind: AttachmentKind
  name: string
  mime: string
  size: number
}

/** Per kind, because the costs differ. An image is resized by the API and
 *  costs about the same whatever its weight, up to the API's own 5 MB cap. A
 *  PDF is billed per page, as text and as a picture of the page. A text file is
 *  billed per token, and 256 KB of Vietnamese is already well over fifty
 *  thousand of them. */
export const MAX_BYTES: Record<AttachmentKind, number> = {
  image: 5 * 1024 * 1024,
  pdf: 10 * 1024 * 1024,
  text: 256 * 1024,
}

/** The ceiling the upload itself is cut off at, before anything is read. */
export const MAX_UPLOAD_BYTES = Math.max(...Object.values(MAX_BYTES))

/** Per message. The request to Anthropic is capped at 32 MB, files travel as
 *  base64 (a third larger), and the last two turns with files are replayed
 *  together — so two full messages have to fit with room to spare. */
export const MAX_PER_MESSAGE = 5
export const MAX_MESSAGE_BYTES = 10 * 1024 * 1024

export type UploadedFile = { buffer: Buffer; originalname: string }

@Injectable()
export class AttachmentsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
  ) {}

  /** Keeps a file for a thread, ahead of the message that will carry it.
   *
   *  The caller has already checked the thread is this person's. What is
   *  checked here is the file: what it really is, and whether it is small
   *  enough to be worth sending. */
  async upload(conversation: Conversation, user: User, file: UploadedFile): Promise<AttachmentRef> {
    const bytes = file.buffer
    if (bytes.length === 0) throw new BadRequestException('attachment_empty')

    const type = sniff(bytes)
    if (!type) throw new BadRequestException('attachment_type_unsupported')
    if (bytes.length > MAX_BYTES[type.kind]) {
      throw new PayloadTooLargeException('attachment_too_large')
    }

    const id = randomUUID()
    const objectKey = `conversations/${conversation.id}/${id}`

    /** Bytes first, row second. A row pointing at nothing is a broken chip in
     *  somebody's thread; bytes nobody points at are only wasted space. */
    await this.store.put(objectKey, bytes, type.mime)

    const [row] = await this.db
      .insert(attachments)
      .values({
        id,
        conversationId: conversation.id,
        uploadedById: user.id,
        kind: type.kind,
        mime: type.mime,
        filename: cleanName(file.originalname, type.kind),
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        objectKey,
      })
      .returning()

    return refOf(row)
  }

  /** The files a message is about to carry, checked and in the order given.
   *
   *  Each must belong to this thread, have been uploaded by this person and not
   *  yet be on a message. The last is what stops one upload riding along on
   *  two questions — harmless in itself, but it would make the record say a
   *  file was sent twice when it was sent once. */
  async claim(conversation: Conversation, user: User, ids: string[]): Promise<Attachment[]> {
    if (ids.length === 0) return []
    if (new Set(ids).size !== ids.length) throw new BadRequestException('attachment_duplicate')
    if (ids.length > MAX_PER_MESSAGE) throw new BadRequestException('attachment_too_many')

    const rows = await this.db
      .select()
      .from(attachments)
      .where(
        and(
          inArray(attachments.id, ids),
          eq(attachments.conversationId, conversation.id),
          eq(attachments.uploadedById, user.id),
        ),
      )

    const byId = new Map(rows.map((row) => [row.id, row]))
    const claimed = ids.map((id) => {
      const row = byId.get(id)
      if (!row) throw new NotFoundException('attachment_not_found')
      if (row.messageId !== null) throw new BadRequestException('attachment_already_sent')
      return row
    })

    const total = claimed.reduce((sum, row) => sum + row.size, 0)
    if (total > MAX_MESSAGE_BYTES) throw new PayloadTooLargeException('attachment_message_too_large')

    return claimed
  }

  /** Pins the files to the turn that carried them. Only ones still loose, so
   *  a second call cannot move a file from one message to another. */
  async link(ids: string[], messageId: string): Promise<void> {
    if (ids.length === 0) return
    await this.db
      .update(attachments)
      .set({ messageId })
      .where(and(inArray(attachments.id, ids), isNull(attachments.messageId)))
  }

  /** The files as the model reads them, by id.
   *
   *  A file that cannot be fetched becomes a line saying so rather than a
   *  failed turn: the person asked a question, and one missing object should
   *  cost them that file, not the answer. */
  async blocks(ids: string[]): Promise<Map<string, Block>> {
    const out = new Map<string, Block>()
    if (ids.length === 0) return out

    const rows = await this.db.select().from(attachments).where(inArray(attachments.id, ids))

    await Promise.all(
      rows.map(async (row) => {
        try {
          out.set(row.id, blockOf(row, await this.store.get(row.objectKey)))
        } catch {
          out.set(row.id, {
            type: 'text',
            text: `[Không đọc được tệp "${row.filename}" từ kho lưu trữ.]`,
          })
        }
      }),
    )

    return out
  }

  /** One file's bytes, for the screen to show. The caller has checked the
   *  thread; this checks the file is in it, so an id from another thread is a
   *  404 like everything else that is not yours. */
  async read(conversation: Conversation, id: string): Promise<{ row: Attachment; bytes: Buffer }> {
    const [row] = await this.db
      .select()
      .from(attachments)
      .where(and(eq(attachments.id, id), eq(attachments.conversationId, conversation.id)))
      .limit(1)

    if (!row) throw new NotFoundException('attachment_not_found')
    return { row, bytes: await this.store.get(row.objectKey) }
  }

  /** Removes a thread's files from storage. The rows go with the thread, by
   *  cascade; the bytes do not, so they are deleted here first. */
  async purge(conversationId: string): Promise<void> {
    const rows = await this.db
      .select({ objectKey: attachments.objectKey })
      .from(attachments)
      .where(eq(attachments.conversationId, conversationId))

    await this.store.remove(rows.map((row) => row.objectKey))
  }
}

export function refOf(row: Attachment): AttachmentRef {
  return {
    type: 'attachment',
    id: row.id,
    kind: row.kind as AttachmentKind,
    name: row.filename,
    mime: row.mime,
    size: row.size,
  }
}

/** What the model is sent for a file. PDFs and text files go as documents so
 *  they carry their name; the model can then say which file it is reading. */
export function blockOf(row: Attachment, bytes: Buffer): Block {
  if (row.kind === 'image') {
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: row.mime as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
        data: bytes.toString('base64'),
      },
    }
  }

  if (row.kind === 'pdf') {
    return {
      type: 'document',
      title: row.filename,
      source: { type: 'base64', media_type: 'application/pdf', data: bytes.toString('base64') },
    }
  }

  return {
    type: 'document',
    title: row.filename,
    source: { type: 'text', media_type: 'text/plain', data: bytes.toString('utf8') },
  }
}

/** What a file is, from its first bytes.
 *
 *  The name and the browser's content type are both whatever the sender says
 *  they are. A renamed executable is `.png` to both; it is not a PNG to this.
 *  Anything that is none of the four image formats and not a PDF is accepted
 *  as text only if it decodes as UTF-8 and holds no NUL byte — which every
 *  binary format fails within its first few bytes. */
export function sniff(bytes: Buffer): { kind: AttachmentKind; mime: string } | null {
  const starts = (signature: number[], at = 0) =>
    bytes.length >= at + signature.length && signature.every((byte, i) => bytes[at + i] === byte)
  const ascii = (text: string, at = 0) => starts([...text].map((c) => c.charCodeAt(0)), at)

  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { kind: 'image', mime: 'image/png' }
  }
  if (starts([0xff, 0xd8, 0xff])) return { kind: 'image', mime: 'image/jpeg' }
  if (ascii('GIF87a') || ascii('GIF89a')) return { kind: 'image', mime: 'image/gif' }
  if (ascii('RIFF') && ascii('WEBP', 8)) return { kind: 'image', mime: 'image/webp' }
  if (ascii('%PDF-')) return { kind: 'pdf', mime: 'application/pdf' }

  if (bytes.includes(0)) return null
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
  return { kind: 'text', mime: 'text/plain' }
}

/** A name safe to show and to put in a header: no path, no control
 *  characters, not absurdly long. Empty after all that, it gets one. */
export function cleanName(name: string, kind: AttachmentKind): string {
  const base = (name.split(/[\\/]/).pop() ?? '')
    .replace(/[\u0000-\u001f\u007f"]/g, '')
    .trim()
    .slice(0, 200)

  if (base) return base
  return kind === 'image' ? 'anh' : kind === 'pdf' ? 'tai-lieu.pdf' : 'van-ban.txt'
}
