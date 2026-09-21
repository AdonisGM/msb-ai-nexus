import { BadRequestException, NotFoundException, PayloadTooLargeException } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { attachments, type Conversation, type User } from '../db/schema'
import { closeDb, resetDb, testDb } from '../test/db'
import { makeBranch, makeConversation, makeMessage } from '../test/factories'
import { MemoryStore } from '../test/memory-store'
import {
  AttachmentsService,
  blockOf,
  cleanName,
  MAX_BYTES,
  MAX_MESSAGE_BYTES,
  MAX_PER_MESSAGE,
  sniff,
} from './attachments.service'

/** What a file is, whether it may be sent, and what the model is shown.
 *
 *  Ownership of the thread is checked by the chat service before any of this
 *  runs, and tested there. What is tested here is the file's side of it: the
 *  bytes decide the type, the limits hold, and a file goes out on exactly one
 *  message, from the person who uploaded it. */

const store = new MemoryStore()
const service = new AttachmentsService(testDb, store)

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16])
const GIF = Buffer.from('GIF89a\x01\x00', 'latin1')
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')])
const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj', 'latin1')
const TEXT = Buffer.from('Khách hỏi vay 2 tỷ mua nhà ở Cầu Giấy.\n', 'utf8')

beforeEach(async () => {
  await resetDb()
  store.objects.clear()
  store.failing = false
})
afterAll(closeDb)

async function thread(): Promise<{ owner: User; other: User; conversation: Conversation }> {
  const b = await makeBranch()
  const conversation = await makeConversation({ ownerId: b.saleRb.id })
  return { owner: b.saleRb, other: b.saleSse, conversation }
}

describe('what a file is', () => {
  it.each([
    ['png', PNG, 'image', 'image/png'],
    ['jpeg', JPEG, 'image', 'image/jpeg'],
    ['gif', GIF, 'image', 'image/gif'],
    ['webp', WEBP, 'image', 'image/webp'],
    ['pdf', PDF, 'pdf', 'application/pdf'],
    ['utf-8 text', TEXT, 'text', 'text/plain'],
  ])('knows %s from its first bytes', (_, bytes, kind, mime) => {
    expect(sniff(bytes)).toEqual({ kind, mime })
  })

  /** The name and the browser's type are both whatever the sender says. */
  it('refuses a binary file whatever it is called', () => {
    const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00])
    expect(sniff(exe)).toBeNull()
  })

  it('refuses bytes that are not valid UTF-8 as text', () => {
    expect(sniff(Buffer.from([0x41, 0xc3, 0x28, 0x42]))).toBeNull()
  })

  /** A RIFF container is also WAV and AVI; only WEBP is an image. */
  it('does not take any RIFF file for a WEBP', () => {
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WAVE')])
    expect(sniff(wav)).toBeNull()
  })

  it('does not take a truncated signature for a match', () => {
    expect(sniff(Buffer.from([0x89, 0x50, 0x4e]))?.kind).not.toBe('image')
  })
})

describe('the name it is shown under', () => {
  it('keeps a Vietnamese name as it is', () => {
    expect(cleanName('Hợp đồng tín dụng.pdf', 'pdf')).toBe('Hợp đồng tín dụng.pdf')
  })

  it('drops any path the browser sent', () => {
    expect(cleanName('C:\\Users\\a\\scan.png', 'image')).toBe('scan.png')
    expect(cleanName('../../etc/passwd', 'text')).toBe('passwd')
  })

  /** It ends up in a Content-Disposition header. */
  it('drops quotes and control characters', () => {
    expect(cleanName('a"b\r\nc.txt', 'text')).toBe('abc.txt')
  })

  it('gives a nameless file a name', () => {
    expect(cleanName('', 'pdf')).toBe('tai-lieu.pdf')
    expect(cleanName('   ', 'image')).toBe('anh')
  })

  it('cuts an absurdly long name', () => {
    expect(cleanName(`${'a'.repeat(500)}.txt`, 'text')).toHaveLength(200)
  })
})

describe('uploading', () => {
  it('keeps the bytes in storage and the facts in the table', async () => {
    const { owner, conversation } = await thread()

    const ref = await service.upload(conversation, owner, { buffer: PDF, originalname: 'hd.pdf' })

    expect(ref).toMatchObject({ type: 'attachment', kind: 'pdf', name: 'hd.pdf', size: PDF.length })

    const [row] = await testDb.select().from(attachments)
    expect(row.conversationId).toBe(conversation.id)
    expect(row.uploadedById).toBe(owner.id)
    expect(row.messageId).toBeNull()
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(store.objects.get(row.objectKey)?.body.equals(PDF)).toBe(true)
    expect(store.objects.get(row.objectKey)?.contentType).toBe('application/pdf')
  })

  /** The browser said image/png; the bytes say PDF. The bytes win. */
  it('records the type the bytes show, not the one the name suggests', async () => {
    const { owner, conversation } = await thread()
    const ref = await service.upload(conversation, owner, { buffer: PDF, originalname: 'anh.png' })
    expect(ref.kind).toBe('pdf')
    expect(ref.mime).toBe('application/pdf')
  })

  it('refuses an empty file', async () => {
    const { owner, conversation } = await thread()
    await expect(
      service.upload(conversation, owner, { buffer: Buffer.alloc(0), originalname: 'a.txt' }),
    ).rejects.toThrow('attachment_empty')
  })

  it('refuses a file it cannot send', async () => {
    const { owner, conversation } = await thread()
    await expect(
      service.upload(conversation, owner, {
        buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]),
        originalname: 'bao-cao.docx',
      }),
    ).rejects.toThrow('attachment_type_unsupported')
    expect(store.objects.size).toBe(0)
  })

  it.each([
    ['an image', PNG, MAX_BYTES.image],
    ['a text file', TEXT, MAX_BYTES.text],
  ])('refuses %s over its own limit', async (_, head, limit) => {
    const { owner, conversation } = await thread()
    const filler = head === TEXT ? Buffer.alloc(limit, 0x61) : Buffer.alloc(limit)
    const big = Buffer.concat([head, filler])

    await expect(
      service.upload(conversation, owner, { buffer: big, originalname: 'big' }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException)
    expect(store.objects.size).toBe(0)
  })

  /** Bytes first, row second: a row pointing at nothing is a broken chip. */
  it('writes no row when storage refuses the bytes', async () => {
    const { owner, conversation } = await thread()
    store.failing = true

    await expect(
      service.upload(conversation, owner, { buffer: PNG, originalname: 'a.png' }),
    ).rejects.toThrow('store_down')
    expect(await testDb.select().from(attachments)).toHaveLength(0)
  })
})

describe('claiming files for a message', () => {
  it('returns them in the order they were given', async () => {
    const { owner, conversation } = await thread()
    const a = await service.upload(conversation, owner, { buffer: PNG, originalname: 'a.png' })
    const b = await service.upload(conversation, owner, { buffer: PDF, originalname: 'b.pdf' })

    const claimed = await service.claim(conversation, owner, [b.id, a.id])
    expect(claimed.map((row) => row.id)).toEqual([b.id, a.id])
  })

  it('claims nothing when nothing is attached', async () => {
    const { owner, conversation } = await thread()
    expect(await service.claim(conversation, owner, [])).toEqual([])
  })

  it('does not know a file from another thread', async () => {
    const { owner, conversation } = await thread()
    const elsewhere = await makeConversation({ ownerId: owner.id })
    const file = await service.upload(elsewhere, owner, { buffer: PNG, originalname: 'a.png' })

    await expect(service.claim(conversation, owner, [file.id])).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })

  /** Only reachable if a thread ever has two people in it, which today it
   *  cannot — but the rule costs one condition and the day it is needed
   *  nobody will remember to add it. */
  it('does not let one person send a file another uploaded', async () => {
    const { owner, other, conversation } = await thread()
    const file = await service.upload(conversation, owner, { buffer: PNG, originalname: 'a.png' })

    await expect(service.claim(conversation, other, [file.id])).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })

  it('does not know an id that was never uploaded', async () => {
    const { owner, conversation } = await thread()
    await expect(service.claim(conversation, owner, ['nope'])).rejects.toThrow(
      'attachment_not_found',
    )
  })

  it('refuses a file already sent on another message', async () => {
    const { owner, conversation } = await thread()
    const file = await service.upload(conversation, owner, { buffer: PNG, originalname: 'a.png' })
    const turn = await makeMessage({ conversationId: conversation.id })
    await service.link([file.id], turn.id)

    await expect(service.claim(conversation, owner, [file.id])).rejects.toThrow(
      'attachment_already_sent',
    )
  })

  it('refuses the same file twice in one message', async () => {
    const { owner, conversation } = await thread()
    const file = await service.upload(conversation, owner, { buffer: PNG, originalname: 'a.png' })

    await expect(service.claim(conversation, owner, [file.id, file.id])).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })

  it(`refuses more than ${MAX_PER_MESSAGE} files in one message`, async () => {
    const { owner, conversation } = await thread()
    const ids: string[] = []
    for (let i = 0; i <= MAX_PER_MESSAGE; i++) {
      ids.push((await service.upload(conversation, owner, { buffer: PNG, originalname: 'a.png' })).id)
    }

    await expect(service.claim(conversation, owner, ids)).rejects.toThrow('attachment_too_many')
  })

  /** Each file is under its own limit; together they would not fit in the
   *  request alongside the turn before. */
  it('refuses files that are too large together', async () => {
    const { owner, conversation } = await thread()
    const pdf = Buffer.concat([PDF, Buffer.alloc(Math.ceil(MAX_MESSAGE_BYTES / 2))])
    const a = await service.upload(conversation, owner, { buffer: pdf, originalname: 'a.pdf' })
    const b = await service.upload(conversation, owner, { buffer: pdf, originalname: 'b.pdf' })

    await expect(service.claim(conversation, owner, [a.id, b.id])).rejects.toThrow(
      'attachment_message_too_large',
    )
  })
})

describe('pinning files to their message', () => {
  it('sets the message on every file named', async () => {
    const { owner, conversation } = await thread()
    const a = await service.upload(conversation, owner, { buffer: PNG, originalname: 'a.png' })
    const b = await service.upload(conversation, owner, { buffer: PDF, originalname: 'b.pdf' })
    const turn = await makeMessage({ conversationId: conversation.id })

    await service.link([a.id, b.id], turn.id)

    const rows = await testDb.select().from(attachments)
    expect(rows.every((row) => row.messageId === turn.id)).toBe(true)
  })

  it('never moves a file off the message it was sent on', async () => {
    const { owner, conversation } = await thread()
    const file = await service.upload(conversation, owner, { buffer: PNG, originalname: 'a.png' })
    const first = await makeMessage({ conversationId: conversation.id, seq: 1 })
    const second = await makeMessage({ conversationId: conversation.id, seq: 2 })

    await service.link([file.id], first.id)
    await service.link([file.id], second.id)

    const [row] = await testDb.select().from(attachments).where(eq(attachments.id, file.id))
    expect(row.messageId).toBe(first.id)
  })
})

describe('what the model is sent', () => {
  it('sends an image as an image', async () => {
    const { owner, conversation } = await thread()
    const file = await service.upload(conversation, owner, { buffer: PNG, originalname: 'a.png' })

    const block = (await service.blocks([file.id])).get(file.id)
    expect(block).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: PNG.toString('base64') },
    })
  })

  it('sends a PDF as a document that carries its name', async () => {
    const { owner, conversation } = await thread()
    const file = await service.upload(conversation, owner, { buffer: PDF, originalname: 'hd.pdf' })

    const block = (await service.blocks([file.id])).get(file.id)
    expect(block).toEqual({
      type: 'document',
      title: 'hd.pdf',
      citations: { enabled: true },
      source: { type: 'base64', media_type: 'application/pdf', data: PDF.toString('base64') },
    })
  })

  /** As text, not base64: the model reads the words, and base64 would cost a
   *  third more tokens for nothing. */
  it('sends a text file as plain text', async () => {
    const { owner, conversation } = await thread()
    const file = await service.upload(conversation, owner, { buffer: TEXT, originalname: 'ghi-chu.txt' })

    const block = (await service.blocks([file.id])).get(file.id)
    expect(block).toEqual({
      type: 'document',
      title: 'ghi-chu.txt',
      citations: { enabled: true },
      source: { type: 'text', media_type: 'text/plain', data: TEXT.toString('utf8') },
    })
  })

  it('says a file could not be read rather than failing the turn', async () => {
    const { owner, conversation } = await thread()
    const file = await service.upload(conversation, owner, { buffer: PNG, originalname: 'a.png' })
    store.objects.clear()

    const block = (await service.blocks([file.id])).get(file.id)
    expect(block).toMatchObject({ type: 'text', text: expect.stringContaining('a.png') })
  })

  it('asks storage for nothing when there is nothing to load', async () => {
    store.failing = true
    expect((await service.blocks([])).size).toBe(0)
  })

  it('builds blocks from a row without the service', () => {
    const block = blockOf(
      { kind: 'image', mime: 'image/webp', filename: 'x.webp' } as never,
      WEBP,
    )
    expect(block).toMatchObject({ type: 'image', source: { media_type: 'image/webp' } })
  })
})

describe('reading a file back', () => {
  it('returns the row and the bytes', async () => {
    const { owner, conversation } = await thread()
    const file = await service.upload(conversation, owner, { buffer: TEXT, originalname: 'a.txt' })

    const { row, bytes } = await service.read(conversation, file.id)
    expect(row.filename).toBe('a.txt')
    expect(bytes.equals(TEXT)).toBe(true)
  })

  it('does not find a file through another thread', async () => {
    const { owner, conversation } = await thread()
    const elsewhere = await makeConversation({ ownerId: owner.id })
    const file = await service.upload(elsewhere, owner, { buffer: PNG, originalname: 'a.png' })

    await expect(service.read(conversation, file.id)).rejects.toBeInstanceOf(NotFoundException)
  })
})

describe('purging a thread', () => {
  it('removes that thread’s bytes and nobody else’s', async () => {
    const { owner, conversation } = await thread()
    const other = await makeConversation({ ownerId: owner.id })
    await service.upload(conversation, owner, { buffer: PNG, originalname: 'a.png' })
    await service.upload(conversation, owner, { buffer: PDF, originalname: 'b.pdf' })
    const kept = await service.upload(other, owner, { buffer: PNG, originalname: 'c.png' })

    await service.purge(conversation.id)

    expect(store.objects.size).toBe(1)
    expect([...store.objects.keys()][0]).toContain(kept.id)
  })
})
