import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, resetDb, testDb } from '../test/db'
import {
  makeBranch,
  makeCustomer,
  makeOpportunity,
  makeSignal,
  makeUser,
  type Branch,
} from '../test/factories'
import { CustomersService } from './customers.service'

const service = new CustomersService(testDb)

beforeEach(resetDb)
afterAll(closeDb)

async function seedBranch(): Promise<Branch> {
  return makeBranch()
}

describe('list', () => {
  it('returns only what the caller may see', async () => {
    const branch = await seedBranch()
    const mine = await makeCustomer({ ownerId: branch.saleRb.id, segment: 'rb' })
    await makeCustomer({ ownerId: branch.saleSse.id, segment: 'sse' })

    const page = await service.list(branch.saleRb, {})

    expect(page.rows.map((row) => row.id)).toEqual([mine.id])
    expect(page.total).toBe(1)
  })

  it("counts only what the caller may see, not the whole table", async () => {
    const branch = await seedBranch()
    await makeCustomer({ ownerId: branch.saleRb.id, segment: 'rb' })
    await makeCustomer({ ownerId: branch.saleSse.id, segment: 'sse' })

    expect((await service.list(branch.saleRb, {})).total).toBe(1)
    expect((await service.list(branch.bm, {})).total).toBe(2)
  })

  it('pages without losing the scope', async () => {
    const branch = await seedBranch()
    for (let i = 0; i < 5; i++) {
      await makeCustomer({ ownerId: branch.saleRb.id, segment: 'rb' })
    }
    await makeCustomer({ ownerId: branch.saleSse.id, segment: 'sse' })

    const first = await service.list(branch.saleRb, { page: 1, pageSize: 2 })
    const last = await service.list(branch.saleRb, { page: 3, pageSize: 2 })

    expect(first.rows).toHaveLength(2)
    expect(last.rows).toHaveLength(1)
    expect(first.total).toBe(5)
  })

  it('filters by segment on top of the scope', async () => {
    const branch = await seedBranch()
    const rb = await makeCustomer({ ownerId: branch.saleRb.id, segment: 'rb' })
    await makeCustomer({ ownerId: branch.saleSse.id, segment: 'sse' })

    const page = await service.list(branch.bm, { segment: 'rb' })
    expect(page.rows.map((row) => row.id)).toEqual([rb.id])
  })

  it('narrows to one salesperson for a team lead', async () => {
    const branch = await seedBranch()
    const theirs = await makeCustomer({ ownerId: branch.saleRb.id, segment: 'rb' })
    await makeCustomer({ ownerId: branch.leadRb.id, segment: 'rb' })

    const page = await service.list(branch.leadRb, { ownerId: branch.saleRb.id })
    expect(page.rows.map((row) => row.id)).toEqual([theirs.id])
  })

  /** An owner filter must not be a way around the scope: asking for a peer's
   *  book returns nothing rather than that peer's customers. */
  it('returns nothing when asked for someone out of scope', async () => {
    const branch = await seedBranch()
    await makeCustomer({ ownerId: branch.saleSse.id, segment: 'sse' })

    const page = await service.list(branch.saleRb, { ownerId: branch.saleSse.id })
    expect(page.rows).toEqual([])
  })

  describe('search', () => {
    it('finds a name typed without its accents', async () => {
      const branch = await seedBranch()
      const customer = await makeCustomer({
        ownerId: branch.saleRb.id,
        segment: 'rb',
        name: 'Nguyễn Văn Hà',
      })

      const page = await service.list(branch.saleRb, { q: 'van ha' })
      expect(page.rows.map((row) => row.id)).toEqual([customer.id])
    })

    it('finds a name typed with accents when the record has none', async () => {
      const branch = await seedBranch()
      const customer = await makeCustomer({
        ownerId: branch.saleRb.id,
        segment: 'rb',
        name: 'Nguyen Van Ha',
      })

      const page = await service.list(branch.saleRb, { q: 'Hà' })
      expect(page.rows.map((row) => row.id)).toEqual([customer.id])
    })

    it('matches on the code too', async () => {
      const branch = await seedBranch()
      const customer = await makeCustomer({
        ownerId: branch.saleRb.id,
        segment: 'rb',
        code: 'CUS-RB-042',
      })

      const page = await service.list(branch.saleRb, { q: 'rb-042' })
      expect(page.rows.map((row) => row.id)).toEqual([customer.id])
    })

    it('still respects the scope while searching', async () => {
      const branch = await seedBranch()
      await makeCustomer({ ownerId: branch.saleSse.id, segment: 'sse', name: 'Công ty Hà An' })

      const page = await service.list(branch.saleRb, { q: 'Hà An' })
      expect(page.rows).toEqual([])
    })
  })
})

describe('get', () => {
  it('returns a customer in scope', async () => {
    const branch = await seedBranch()
    const customer = await makeCustomer({ ownerId: branch.saleRb.id, segment: 'rb' })

    expect((await service.get(branch.saleRb, customer.id)).id).toBe(customer.id)
  })

  /** Reported as missing rather than forbidden: confirming that a record
   *  exists but belongs to someone else is already a leak. */
  it("reports a peer's customer as missing, not forbidden", async () => {
    const branch = await seedBranch()
    const theirs = await makeCustomer({ ownerId: branch.saleSse.id, segment: 'sse' })

    await expect(service.get(branch.saleRb, theirs.id)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('lets a team lead read their own people', async () => {
    const branch = await seedBranch()
    const customer = await makeCustomer({ ownerId: branch.saleRb.id, segment: 'rb' })

    expect((await service.get(branch.leadRb, customer.id)).id).toBe(customer.id)
    await expect(service.get(branch.leadSse, customer.id)).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })

  it('throws for an id that does not exist at all', async () => {
    const branch = await seedBranch()
    await expect(service.get(branch.bm, 'nope')).rejects.toBeInstanceOf(NotFoundException)
  })
})

describe('create', () => {
  it('puts a new customer in the caller’s own book by default', async () => {
    const branch = await seedBranch()

    const customer = await service.create(branch.saleRb, { name: 'Anh A', segment: 'rb' })

    expect(customer.ownerId).toBe(branch.saleRb.id)
    expect(customer.code).toBe('CUS-RB-001')
  })

  it('numbers codes per segment', async () => {
    const branch = await seedBranch()

    const first = await service.create(branch.saleRb, { name: 'A', segment: 'rb' })
    const second = await service.create(branch.saleRb, { name: 'B', segment: 'rb' })
    const other = await service.create(branch.saleSse, { name: 'C', segment: 'sse' })

    expect([first.code, second.code, other.code]).toEqual([
      'CUS-RB-001',
      'CUS-RB-002',
      'CUS-SSE-001',
    ])
  })

  it('lets a team lead assign to one of their own people', async () => {
    const branch = await seedBranch()

    const customer = await service.create(branch.leadRb, {
      name: 'Anh A',
      segment: 'rb',
      ownerId: branch.saleRb.id,
    })

    expect(customer.ownerId).toBe(branch.saleRb.id)
  })

  /** Without this the scope on the way out would be decorative: anyone could
   *  push a row into a colleague's book and simply lose sight of it. */
  it("refuses to assign into a peer's book", async () => {
    const branch = await seedBranch()

    await expect(
      service.create(branch.leadRb, {
        name: 'Anh A',
        segment: 'sse',
        ownerId: branch.saleSse.id,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('refuses a segment the owner does not cover', async () => {
    const branch = await seedBranch()

    await expect(
      service.create(branch.saleRb, { name: 'Công ty A', segment: 'sse' }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('refuses to put a customer in a branch manager’s name', async () => {
    const branch = await seedBranch()

    await expect(
      service.create(branch.bm, { name: 'Anh A', segment: 'rb', ownerId: branch.bm.id }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('keeps segment-specific fields in attributes', async () => {
    const branch = await seedBranch()

    const customer = await service.create(branch.saleRb, {
      name: 'Anh A',
      segment: 'rb',
      attributes: { repaymentSource: 'salary', collateral: 'apartment' },
      currentProducts: ['payment_account'],
      revenue: 1_200_000_000,
    })

    expect(customer.attributes).toEqual({
      repaymentSource: 'salary',
      collateral: 'apartment',
    })
    expect(customer.currentProducts).toEqual(['payment_account'])
    expect(customer.revenue).toBe(1_200_000_000)
  })

  it('defaults the flexible fields rather than leaving them null', async () => {
    const branch = await seedBranch()
    const customer = await service.create(branch.saleRb, { name: 'Anh A', segment: 'rb' })

    expect(customer.attributes).toEqual({})
    expect(customer.currentProducts).toEqual([])
    expect(customer.revenue).toBeNull()
  })

  it('walks past a code already taken', async () => {
    const branch = await seedBranch()
    await makeCustomer({ ownerId: branch.saleRb.id, segment: 'rb', code: 'CUS-RB-001' })

    const customer = await service.create(branch.saleRb, { name: 'Anh A', segment: 'rb' })
    expect(customer.code).toBe('CUS-RB-002')
  })
})

describe('update', () => {
  it('edits a customer in scope', async () => {
    const branch = await seedBranch()
    const customer = await makeCustomer({ ownerId: branch.saleRb.id, segment: 'rb' })

    const updated = await service.update(branch.saleRb, customer.id, { name: 'Anh B' })
    expect(updated.name).toBe('Anh B')
  })

  it("refuses to edit a peer's customer", async () => {
    const branch = await seedBranch()
    const theirs = await makeCustomer({ ownerId: branch.saleSse.id, segment: 'sse' })

    await expect(
      service.update(branch.saleRb, theirs.id, { name: 'Taken' }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('leaves untouched fields alone', async () => {
    const branch = await seedBranch()
    const customer = await makeCustomer({
      ownerId: branch.saleRb.id,
      segment: 'rb',
      note: 'Keep me',
      attributes: { repaymentSource: 'salary' },
    })

    const updated = await service.update(branch.saleRb, customer.id, { name: 'Anh B' })

    expect(updated.note).toBe('Keep me')
    expect(updated.attributes).toEqual({ repaymentSource: 'salary' })
  })

  it('lets a team lead hand a customer to another of their people', async () => {
    const branch = await seedBranch()
    const customer = await makeCustomer({ ownerId: branch.saleRb.id, segment: 'rb' })
    const second = await makeUser({
      unitId: branch.unit.id,
      role: 'sale',
      segment: 'rb',
      managerId: branch.leadRb.id,
    })

    const updated = await service.update(branch.leadRb, customer.id, { ownerId: second.id })
    expect(updated.ownerId).toBe(second.id)
  })

  it("refuses to hand a customer to a peer's salesperson", async () => {
    const branch = await seedBranch()
    const customer = await makeCustomer({ ownerId: branch.saleRb.id, segment: 'rb' })

    await expect(
      service.update(branch.leadRb, customer.id, { ownerId: branch.saleSse.id }),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('refuses a new owner who does not cover the segment', async () => {
    const branch = await seedBranch()
    const customer = await makeCustomer({ ownerId: branch.saleRb.id, segment: 'rb' })
    const sseSale = await makeUser({
      unitId: branch.unit.id,
      role: 'sale',
      segment: 'sse',
      managerId: branch.leadRb.id,
    })

    await expect(
      service.update(branch.leadRb, customer.id, { ownerId: sseSale.id }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('moves the updated mark so the list resorts', async () => {
    const branch = await seedBranch()
    const customer = await makeCustomer({ ownerId: branch.saleRb.id, segment: 'rb' })

    const updated = await service.update(branch.saleRb, customer.id, { name: 'Anh B' })
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(customer.updatedAt.getTime())
  })
})

describe('what a customer row carries', () => {
  async function scene() {
    const branch = await makeBranch()
    const customer = await makeCustomer({ ownerId: branch.saleRb.id, segment: 'rb' })
    return { ...branch, customer }
  }

  /** A team lead or branch manager looking at a mixed list otherwise sees rows
   *  with no owner on them and an id they cannot read. */
  it('names whose book it is', async () => {
    const s = await scene()
    const [row] = (await service.list(s.leadRb, {})).rows
    expect(row.ownerName).toBe(s.saleRb.name)
  })

  it('counts the leads on the file, by how they stand', async () => {
    const s = await scene()
    await makeOpportunity({ customerId: s.customer.id, ownerId: s.saleRb.id })
    await makeOpportunity({
      customerId: s.customer.id,
      ownerId: s.saleRb.id,
      stage: 'contacted',
    })
    await makeOpportunity({
      customerId: s.customer.id,
      ownerId: s.saleRb.id,
      stage: 'advised',
      outcome: 'won',
    })
    await makeOpportunity({
      customerId: s.customer.id,
      ownerId: s.saleRb.id,
      stage: 'contacted',
      outcome: 'lost',
    })

    const [row] = (await service.list(s.saleRb, {})).rows
    expect(row.leads).toEqual({ total: 4, open: 1, won: 1, lost: 1, untouched: 1 })
  })

  /** The contract the screen depends on, and the one that fails loudly when
   *  it breaks: the four buckets are drawn as a single stacked bar and a
   *  single donut, so an overlap does not read as a small inaccuracy — the bar
   *  overflows and the percentages pass a hundred.
   *
   *  `open` therefore excludes the leads nobody has called; those are counted
   *  once, under `untouched`. */
  it('splits the leads into four buckets that add up to the total', async () => {
    const s = await scene()
    for (const shape of [
      {},
      {},
      { stage: 'contacted' as const },
      { stage: 'advised' as const },
      { stage: 'advised' as const, outcome: 'won' as const },
      { stage: 'contacted' as const, outcome: 'lost' as const },
    ]) {
      await makeOpportunity({ customerId: s.customer.id, ownerId: s.saleRb.id, ...shape })
    }

    const { leads } = (await service.list(s.saleRb, {})).rows[0]
    expect(leads).toEqual({ total: 6, open: 2, won: 1, lost: 1, untouched: 2 })
    expect(leads.open + leads.won + leads.lost + leads.untouched).toBe(leads.total)
  })

  /** Sent as zeroes rather than left missing, so no screen has to check for
   *  an absent object before reading a number off it. */
  it('sends zeroes for a customer with no leads at all', async () => {
    const s = await scene()
    const [row] = (await service.list(s.saleRb, {})).rows
    expect(row.leads).toEqual({ total: 0, open: 0, won: 0, lost: 0, untouched: 0 })
  })

  it('counts only that customer’s own leads', async () => {
    const s = await scene()
    const other = await makeCustomer({ ownerId: s.saleRb.id, segment: 'rb' })
    await makeOpportunity({ customerId: s.customer.id, ownerId: s.saleRb.id })
    await makeOpportunity({ customerId: other.id, ownerId: s.saleRb.id })
    await makeOpportunity({ customerId: other.id, ownerId: s.saleRb.id })

    const rows = (await service.list(s.saleRb, {})).rows
    const byId = new Map(rows.map((row) => [row.id, row.leads.total]))
    expect(byId.get(s.customer.id)).toBe(1)
    expect(byId.get(other.id)).toBe(2)
  })

  /** Three weeks of silence on a file is the signal itself — what a team lead
   *  chases, and what the model will rank a day's calls by. */
  it('says when anything was last heard about the customer', async () => {
    const s = await scene()
    const older = new Date('2026-08-01T09:00:00Z')
    const newer = new Date('2026-09-10T09:00:00Z')

    await makeSignal({ customerId: s.customer.id, observedAt: older })
    await makeSignal({ customerId: s.customer.id, observedAt: newer })

    const [row] = (await service.list(s.saleRb, {})).rows
    expect(row.lastSignalAt).toEqual(newer)
  })

  /** Dated by when it was observed, not when it was typed: a Friday meeting
   *  written up on Monday still has to sort as Friday. */
  it('reads the observed date, not the day it was entered', async () => {
    const s = await scene()
    const observed = new Date('2026-07-04T09:00:00Z')
    await makeSignal({ customerId: s.customer.id, observedAt: observed })

    const [row] = (await service.list(s.saleRb, {})).rows
    expect(row.lastSignalAt).toEqual(observed)
  })

  it('sends nothing when nobody has ever recorded anything', async () => {
    const s = await scene()
    const [row] = (await service.list(s.saleRb, {})).rows
    expect(row.lastSignalAt).toBeNull()
  })

  it('keeps the summary aligned to its own row across a page', async () => {
    const s = await scene()
    const second = await makeCustomer({ ownerId: s.saleRb.id, segment: 'rb' })
    await makeOpportunity({ customerId: second.id, ownerId: s.saleRb.id, stage: 'advised', outcome: 'won' })
    await makeSignal({ customerId: s.customer.id })

    const rows = (await service.list(s.saleRb, {})).rows
    const first = rows.find((row) => row.id === s.customer.id)!
    const other = rows.find((row) => row.id === second.id)!

    expect(first.leads.total).toBe(0)
    expect(first.lastSignalAt).not.toBeNull()
    expect(other.leads.won).toBe(1)
    expect(other.lastSignalAt).toBeNull()
  })
})

describe('the totals above the table', () => {
  async function scene() {
    const branch = await makeBranch()
    const customer = await makeCustomer({ ownerId: branch.saleRb.id, segment: 'rb' })
    return { ...branch, customer }
  }

  /** Counted across everything the filter matched, not across the page. A
   *  donut that only knew about the twenty-five rows on screen would change
   *  every time somebody paged, and be wrong on all of them but the first. */
  it('counts every match, not just the page in front of you', async () => {
    const s = await scene()
    for (let i = 0; i < 6; i++) {
      const customer = await makeCustomer({ ownerId: s.saleRb.id, segment: 'rb' })
      await makeOpportunity({
        customerId: customer.id,
        ownerId: s.saleRb.id,
        stage: 'advised',
        outcome: 'won',
      })
    }

    const page = await service.list(s.saleRb, { pageSize: 2 })
    expect(page.rows).toHaveLength(2)
    expect(page.summary.leads).toEqual({ total: 6, open: 0, won: 6, lost: 0, untouched: 0 })
  })

  it('narrows with the filter it is shown under', async () => {
    const s = await scene()
    const sse = await makeCustomer({ ownerId: s.saleSse.id, segment: 'sse' })
    await makeOpportunity({ customerId: s.customer.id, ownerId: s.saleRb.id })
    await makeOpportunity({ customerId: sse.id, ownerId: s.saleSse.id, segment: 'sse' })

    expect((await service.list(s.bm, {})).summary.leads.total).toBe(2)
    expect((await service.list(s.bm, { segment: 'rb' })).summary.leads.total).toBe(1)
  })

  /** "Tổng doanh thu" under a filtered table means the filtered total. Adding
   *  up one page of it is a number that is never right and never obviously
   *  wrong. */
  it('sums the revenue across the match', async () => {
    const s = await scene()
    await makeCustomer({ ownerId: s.saleRb.id, segment: 'rb', revenue: 3_000_000_000 })
    await makeCustomer({ ownerId: s.saleRb.id, segment: 'rb', revenue: 2_000_000_000 })

    const { summary } = await service.list(s.saleRb, { pageSize: 1 })
    expect(summary.revenue).toBe(5_000_000_000)
  })

  it('reports zero rather than nothing when the match is empty', async () => {
    const s = await scene()
    const { summary } = await service.list(s.saleRb, { q: 'khong-co-ai-ten-nhu-vay' })

    expect(summary.revenue).toBe(0)
    expect(summary.leads).toEqual({ total: 0, open: 0, won: 0, lost: 0, untouched: 0 })
  })

  /** The scope is applied before anything else, so a branch manager's totals
   *  stop at their own branch even though the filter said nothing about it. */
  it('never counts past the caller’s scope', async () => {
    const s = await scene()
    const elsewhere = await makeBranch()
    const theirs = await makeCustomer({ ownerId: elsewhere.saleRb.id, segment: 'rb' })
    await makeOpportunity({ customerId: theirs.id, ownerId: elsewhere.saleRb.id })
    await makeOpportunity({ customerId: s.customer.id, ownerId: s.saleRb.id })

    expect((await service.list(s.bm, {})).summary.leads.total).toBe(1)
  })
})

describe('narrowing the list', () => {
  async function scene() {
    const branch = await makeBranch()
    return branch
  }

  /** The box says "Tìm mã, tên khách, người liên hệ, số điện thoại", so all
   *  four have to work. People search by the person they actually spoke to,
   *  and by the number they are about to dial. */
  it('searches the contact and the phone, not only the customer', async () => {
    const s = await scene()
    await makeCustomer({
      ownerId: s.saleRb.id,
      name: 'Công ty Hoàng Long',
      contactName: 'Chị Mai Phương',
      contactPhone: '0987654321',
    })
    await makeCustomer({ ownerId: s.saleRb.id, name: 'Khách khác' })

    for (const q of ['Hoàng Long', 'Mai Phương', '098765', 'mai phuong']) {
      expect((await service.list(s.saleRb, { q })).total, q).toBe(1)
    }
  })

  it('filters by a product the customer already holds', async () => {
    const s = await scene()
    await makeCustomer({
      ownerId: s.saleRb.id,
      currentProducts: ['Thẻ tín dụng', 'Chi lương'],
    })
    await makeCustomer({ ownerId: s.saleRb.id, currentProducts: ['Máy POS'] })
    await makeCustomer({ ownerId: s.saleRb.id })

    expect((await service.list(s.saleRb, { product: 'Chi lương' })).total).toBe(1)
    expect((await service.list(s.saleRb, { product: 'Máy POS' })).total).toBe(1)
    expect((await service.list(s.saleRb, { product: 'Không có' })).total).toBe(0)
  })

  it('filters by relation stage', async () => {
    const s = await scene()
    await makeCustomer({ ownerId: s.saleRb.id, relationStage: 'Đang giao dịch' })
    await makeCustomer({ ownerId: s.saleRb.id, relationStage: 'Mới tiếp cận' })

    expect((await service.list(s.saleRb, { relationStage: 'Đang giao dịch' })).total).toBe(1)
  })

  /** "At least one", and the label has to say so. A customer is not won or
   *  lost, their leads are. */
  it('finds customers with at least one lead standing a given way', async () => {
    const s = await scene()
    const won = await makeCustomer({ ownerId: s.saleRb.id })
    const fresh = await makeCustomer({ ownerId: s.saleRb.id })
    await makeCustomer({ ownerId: s.saleRb.id })

    await makeOpportunity({
      customerId: won.id,
      ownerId: s.saleRb.id,
      stage: 'advised',
      outcome: 'won',
    })
    /** Same customer also has an untouched one — they belong in both chips. */
    await makeOpportunity({ customerId: won.id, ownerId: s.saleRb.id })
    await makeOpportunity({ customerId: fresh.id, ownerId: s.saleRb.id })

    expect((await service.list(s.saleRb, { hasLead: 'won' })).total).toBe(1)
    expect((await service.list(s.saleRb, { hasLead: 'untouched' })).total).toBe(2)
    expect((await service.list(s.saleRb, { hasLead: 'open' })).total).toBe(0)
    expect((await service.list(s.saleRb, { hasLead: 'lost' })).total).toBe(0)
  })

  describe('the date window', () => {
    async function withSignals() {
      const s = await scene()
      const july = await makeCustomer({ ownerId: s.saleRb.id, name: 'Tháng bảy' })
      const september = await makeCustomer({ ownerId: s.saleRb.id, name: 'Tháng chín' })
      const silent = await makeCustomer({ ownerId: s.saleRb.id, name: 'Chưa có tin' })

      await makeSignal({ customerId: july.id, observedAt: new Date('2026-07-04T09:00:00Z') })
      await makeSignal({
        customerId: september.id,
        observedAt: new Date('2026-09-10T09:00:00Z'),
      })
      return { ...s, july, september, silent }
    }

    it('windows on the newest signal, which is not a column', async () => {
      const f = await withSignals()

      const recent = await f.saleRb
      const rows = await service.list(recent, { from: '2026-08-01' })
      expect(rows.rows.map((row) => row.name).sort()).toEqual(
        ['Chưa có tin', 'Tháng chín'].sort(),
      )
    })

    /** "We have heard nothing since August" and "we have never heard
     *  anything" are the same worry, and the second is worse. A window that
     *  dropped the silent ones would hide exactly the rows it is for. */
    it('never drops a customer nobody has recorded anything about', async () => {
      const f = await withSignals()

      for (const window of [{ from: '2026-09-01' }, { to: '2026-01-01' }]) {
        const names = (await service.list(f.saleRb, window)).rows.map((row) => row.name)
        expect(names, JSON.stringify(window)).toContain('Chưa có tin')
      }
    })

    it('includes both ends of the window', async () => {
      const f = await withSignals()

      const exact = await service.list(f.saleRb, {
        from: '2026-09-10',
        to: '2026-09-10',
      })
      expect(exact.rows.map((row) => row.name)).toContain('Tháng chín')
      expect(exact.rows.map((row) => row.name)).not.toContain('Tháng bảy')
    })

    it('windows on the created date when asked to', async () => {
      const f = await withSignals()

      const none = await service.list(f.saleRb, {
        dateField: 'createdAt',
        to: '2020-01-01',
      })
      expect(none.total).toBe(0)

      const all = await service.list(f.saleRb, {
        dateField: 'createdAt',
        from: '2020-01-01',
      })
      expect(all.total).toBe(3)
    })

    /** Every filter is added on top of the scope, never in place of it. */
    it('keeps the totals in step with the window', async () => {
      const f = await withSignals()
      await makeOpportunity({ customerId: f.september.id, ownerId: f.saleRb.id })
      await makeOpportunity({ customerId: f.july.id, ownerId: f.saleRb.id })

      const windowed = await service.list(f.saleRb, { from: '2026-08-01' })
      expect(windowed.summary.leads.total).toBe(1)
    })
  })
})

describe('the values behind the pickers', () => {
  it('reads both lists out of the data, sorted and without gaps', async () => {
    const branch = await makeBranch()
    await makeCustomer({
      ownerId: branch.saleRb.id,
      relationStage: 'Đang giao dịch',
      currentProducts: ['Thẻ tín dụng', 'Chi lương'],
    })
    await makeCustomer({
      ownerId: branch.saleRb.id,
      relationStage: 'Mới tiếp cận',
      currentProducts: ['Chi lương'],
    })
    await makeCustomer({ ownerId: branch.saleRb.id, relationStage: null })

    const facets = await service.facets(branch.saleRb)
    expect(facets.relationStages).toEqual(['Mới tiếp cận', 'Đang giao dịch'])
    expect(facets.products).toEqual(['Chi lương', 'Thẻ tín dụng'])
  })

  /** Scoped like everything else: a salesperson's dropdown offers what
   *  appears in their own book, not the branch's. */
  it('offers only what is in the caller’s own book', async () => {
    const branch = await makeBranch()
    await makeCustomer({
      ownerId: branch.saleSse.id,
      segment: 'sse',
      relationStage: 'Của người khác',
      currentProducts: ['Bảo lãnh'],
    })

    expect(await service.facets(branch.saleRb)).toEqual({
      relationStages: [],
      products: [],
    })
    expect((await service.facets(branch.bm)).relationStages).toEqual(['Của người khác'])
  })
})

describe('one customer on their own', () => {
  /** A detail screen that showed less than the row it was opened from reads
   *  as a step backwards — and the four figures across the top of it are
   *  exactly these three fields. */
  it('carries the same extras the list row does', async () => {
    const branch = await makeBranch()
    const customer = await makeCustomer({ ownerId: branch.saleRb.id, segment: 'rb' })
    await makeOpportunity({ customerId: customer.id, ownerId: branch.saleRb.id })
    await makeOpportunity({
      customerId: customer.id,
      ownerId: branch.saleRb.id,
      stage: 'advised',
      outcome: 'won',
    })
    await makeSignal({ customerId: customer.id, observedAt: new Date('2026-09-10T09:00:00Z') })

    const one = await service.get(branch.saleRb, customer.id)
    const [row] = (await service.list(branch.saleRb, {})).rows

    expect(one.ownerName).toBe(row.ownerName)
    expect(one.leads).toEqual(row.leads)
    expect(one.lastSignalAt).toEqual(row.lastSignalAt)
    expect(one.leads).toEqual({ total: 2, open: 0, won: 1, lost: 0, untouched: 1 })
  })

  it('reports zeroes and nothing for a customer with no history', async () => {
    const branch = await makeBranch()
    const customer = await makeCustomer({ ownerId: branch.saleRb.id })

    const one = await service.get(branch.saleRb, customer.id)
    expect(one.leads).toEqual({ total: 0, open: 0, won: 0, lost: 0, untouched: 0 })
    expect(one.lastSignalAt).toBeNull()
  })
})
