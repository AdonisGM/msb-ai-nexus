import { NotFoundException } from '@nestjs/common'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, resetDb, testDb } from '../test/db'
import { makeBranch, makeCustomer, makeSignal } from '../test/factories'
import { SignalsService } from './signals.service'

const service = new SignalsService(testDb)

beforeEach(resetDb)
afterAll(closeDb)

async function scene() {
  const branch = await makeBranch()
  const customer = await makeCustomer({ ownerId: branch.saleRb.id, segment: 'rb' })
  return { ...branch, customerId: customer.id }
}

describe('create', () => {
  it('records an observation against the customer', async () => {
    const s = await scene()

    const signal = await service.create(s.saleRb, s.customerId, {
      type: 'competition',
      content: 'Đang so lãi suất với ngân hàng khác',
    })

    expect(signal.customerId).toBe(s.customerId)
    expect(signal.type).toBe('competition')
    expect(signal.authorId).toBe(s.saleRb.id)
  })

  /** Letting a caller claim to be the system or the model would put
   *  unattributable observations in a customer file. */
  it('always attributes an observation to the person who wrote it', async () => {
    const s = await scene()

    const signal = await service.create(s.saleRb, s.customerId, {
      type: 'need',
      content: 'Cần vốn lưu động',
    })

    expect(signal.source).toBe('sale')
    expect(signal.authorId).toBe(s.saleRb.id)
  })

  /** The evidence behind anything inferred from it later: the sentence as it
   *  was actually typed. */
  it('keeps the original sentence verbatim', async () => {
    const s = await scene()
    const note = 'Tôi vừa gặp khách, khách cần vay 2 tỷ trước 30/9'

    const signal = await service.create(s.saleRb, s.customerId, {
      type: 'deadline',
      content: 'Cần giải ngân trước 30/9',
      rawNote: note,
    })

    expect(signal.rawNote).toBe(note)
  })

  it('takes the observation date from the caller, not the clock', async () => {
    const s = await scene()

    const signal = await service.create(s.saleRb, s.customerId, {
      type: 'need',
      content: 'Gặp hôm thứ Sáu',
      observedAt: '2026-09-11T02:00:00.000Z',
    })

    expect(signal.observedAt.toISOString()).toBe('2026-09-11T02:00:00.000Z')
    expect(signal.createdAt.getTime()).toBeGreaterThan(signal.observedAt.getTime())
  })

  it('defaults the observation date to now', async () => {
    const s = await scene()
    const before = Date.now()

    const signal = await service.create(s.saleRb, s.customerId, {
      type: 'need',
      content: 'Vừa gọi xong',
    })

    expect(signal.observedAt.getTime()).toBeGreaterThanOrEqual(before - 1000)
  })

  it("refuses to write against a peer's customer", async () => {
    const s = await scene()
    const theirs = await makeCustomer({ ownerId: s.saleSse.id, segment: 'sse' })

    await expect(
      service.create(s.saleRb, theirs.id, { type: 'need', content: 'Mine now' }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('lets a team lead add to their own people’s files', async () => {
    const s = await scene()

    const signal = await service.create(s.leadRb, s.customerId, {
      type: 'documents',
      content: 'Hồ sơ pháp lý đã đủ',
    })

    expect(signal.authorId).toBe(s.leadRb.id)
  })
})

describe('list', () => {
  it('returns the timeline newest first', async () => {
    const s = await scene()

    await makeSignal({
      customerId: s.customerId,
      content: 'older',
      observedAt: new Date('2026-09-01T00:00:00Z'),
    })
    await makeSignal({
      customerId: s.customerId,
      content: 'newer',
      observedAt: new Date('2026-09-10T00:00:00Z'),
    })

    const rows = await service.list(s.saleRb, s.customerId)
    expect(rows.map((row) => row.content)).toEqual(['newer', 'older'])
  })

  /** Sorting by when something was seen, not when it was typed, is what keeps
   *  a Friday meeting written up on Monday in the right place. */
  it('orders by when it was observed, not when it was entered', async () => {
    const s = await scene()

    await makeSignal({
      customerId: s.customerId,
      content: 'entered first, seen later',
      observedAt: new Date('2026-09-10T00:00:00Z'),
    })
    await makeSignal({
      customerId: s.customerId,
      content: 'entered later, seen first',
      observedAt: new Date('2026-09-01T00:00:00Z'),
    })

    const rows = await service.list(s.saleRb, s.customerId)
    expect(rows[0].content).toBe('entered first, seen later')
  })

  it('filters by type', async () => {
    const s = await scene()
    await makeSignal({ customerId: s.customerId, type: 'competition', content: 'a' })
    await makeSignal({ customerId: s.customerId, type: 'need', content: 'b' })

    const rows = await service.list(s.saleRb, s.customerId, { type: 'competition' })
    expect(rows.map((row) => row.content)).toEqual(['a'])
  })

  it('caps how much comes back', async () => {
    const s = await scene()
    for (let i = 0; i < 5; i++) {
      await makeSignal({ customerId: s.customerId, content: `signal ${i}` })
    }

    expect(await service.list(s.saleRb, s.customerId, { limit: 2 })).toHaveLength(2)
  })

  it('shows a team lead their own people’s timeline', async () => {
    const s = await scene()
    await makeSignal({ customerId: s.customerId, content: 'visible' })

    expect(await service.list(s.leadRb, s.customerId)).toHaveLength(1)
  })

  it("refuses another team's timeline", async () => {
    const s = await scene()
    await makeSignal({ customerId: s.customerId })

    await expect(service.list(s.leadSse, s.customerId)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('shows a branch manager the whole unit', async () => {
    const s = await scene()
    await makeSignal({ customerId: s.customerId })

    expect(await service.list(s.bm, s.customerId)).toHaveLength(1)
  })

  it('returns an empty timeline rather than failing', async () => {
    const s = await scene()
    expect(await service.list(s.saleRb, s.customerId)).toEqual([])
  })
})

describe('append-only', () => {
  /** Correcting a signal means writing a newer one, never editing the old.
   *  The service exposes no way to do otherwise, and this test is what stops
   *  a convenient `update` being added later without the argument being had. */
  it('offers no way to change or remove what was recorded', () => {
    const surface = Object.getOwnPropertyNames(SignalsService.prototype)
    expect(surface).not.toContain('update')
    expect(surface).not.toContain('remove')
    expect(surface).not.toContain('delete')
  })

  it('corrects an earlier reading by writing over the top of it', async () => {
    const s = await scene()

    await service.create(s.saleRb, s.customerId, {
      type: 'competition',
      content: 'Khách so lãi với VCB',
      observedAt: '2026-09-01T00:00:00.000Z',
    })
    await service.create(s.saleRb, s.customerId, {
      type: 'competition',
      content: 'Thực ra khách so với Techcombank',
      observedAt: '2026-09-02T00:00:00.000Z',
    })

    const rows = await service.list(s.saleRb, s.customerId)

    /** Both survive: the newest reading leads, and the earlier mistake stays
     *  on the record. */
    expect(rows).toHaveLength(2)
    expect(rows[0].content).toContain('Techcombank')
  })
})

describe('who wrote it', () => {
  /** The timeline reads "Sale ghi, Hải". An id cannot be rendered as a
   *  person, and the screen does not hold the roster. */
  it('names the person who recorded it', async () => {
    const branch = await makeBranch()
    const customer = await makeCustomer({ ownerId: branch.saleRb.id })
    await makeSignal({
      customerId: customer.id,
      source: 'sale',
      authorId: branch.saleRb.id,
    })

    const [row] = await service.list(branch.saleRb, customer.id)
    expect(row.authorName).toBe(branch.saleRb.name)
    expect(row.authorRole).toBe('sale')
  })

  /** The system and the model are allowed to be anonymous, and the screen
   *  shows the source alone rather than inventing an author for them. */
  it('leaves the name empty when nobody wrote it', async () => {
    const branch = await makeBranch()
    const customer = await makeCustomer({ ownerId: branch.saleRb.id })
    await makeSignal({ customerId: customer.id, source: 'ai' })

    const [row] = await service.list(branch.saleRb, customer.id)
    expect(row.source).toBe('ai')
    expect(row.authorName).toBeNull()
  })
})
