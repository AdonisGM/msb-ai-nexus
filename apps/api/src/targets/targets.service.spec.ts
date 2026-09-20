import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, resetDb, testDb } from '../test/db'
import { makeBranch, makeUser } from '../test/factories'
import { TargetsService } from './targets.service'

const service = new TargetsService(testDb)

beforeEach(resetDb)
afterAll(closeDb)

const Q3 = '2026-Q3'

describe('setting a number', () => {
  it('records the unit number for the quarter', async () => {
    const branch = await makeBranch()

    const target = await service.set(branch.bm, {
      scope: 'unit',
      period: Q3,
      metric: 'value', amount: 10_000_000_000,
    })

    expect(target.scope).toBe('unit')
    expect(target.ownerId).toBeNull()
    expect(target.unitId).toBe(branch.unit.id)
    expect(target.amount).toBe(10_000_000_000)
  })

  it('records a personal number against the right person', async () => {
    const branch = await makeBranch()

    const target = await service.set(branch.bm, {
      scope: 'user',
      ownerId: branch.saleRb.id,
      period: Q3,
      metric: 'value', amount: 2_000_000_000,
    })

    expect(target.ownerId).toBe(branch.saleRb.id)
    expect(target.unitId).toBe(branch.unit.id)
  })

  it('splits a unit number by segment so the two teams can be compared', async () => {
    const branch = await makeBranch()

    for (const segment of ['sse', 'rb'] as const) {
      await service.set(branch.bm, {
        scope: 'unit',
        segment,
        period: Q3,
        metric: 'value', amount: 5_000_000_000,
      })
    }

    const rows = await service.list(branch.bm, { period: Q3 })
    expect(rows.map((row) => row.segment).sort()).toEqual(['rb', 'sse'])
  })

  /** Allocating a quarter is an iterative conversation. A second row for the
   *  same thing would make the gap depend on which one a query read first. */
  it('replaces the number rather than adding a second one', async () => {
    const branch = await makeBranch()

    await service.set(branch.bm, { scope: 'unit', period: Q3, metric: 'value', amount: 10_000_000_000 })
    const revised = await service.set(branch.bm, {
      scope: 'unit',
      period: Q3,
      metric: 'value', amount: 12_000_000_000,
      note: 'Revised after the review',
    })

    expect(revised.amount).toBe(12_000_000_000)
    expect(revised.note).toBe('Revised after the review')
    expect(await service.list(branch.bm, { period: Q3 })).toHaveLength(1)
  })

  it('keeps separate quarters apart', async () => {
    const branch = await makeBranch()

    await service.set(branch.bm, { scope: 'unit', period: Q3, metric: 'value', amount: 10_000_000_000 })
    await service.set(branch.bm, { scope: 'unit', period: '2026-Q4', metric: 'value', amount: 11_000_000_000 })

    expect(await service.list(branch.bm)).toHaveLength(2)
  })

  /** A unit number is not the sum of its people's — a branch routinely carries
   *  more than it hands out, so both are stored and neither is derived. */
  it('lets a unit number differ from the sum of its people', async () => {
    const branch = await makeBranch()

    await service.set(branch.bm, { scope: 'unit', period: Q3, metric: 'value', amount: 10_000_000_000 })
    await service.set(branch.bm, {
      scope: 'user',
      ownerId: branch.saleRb.id,
      period: Q3,
      metric: 'value', amount: 2_000_000_000,
    })
    await service.set(branch.bm, {
      scope: 'user',
      ownerId: branch.saleSse.id,
      period: Q3,
      metric: 'value', amount: 3_000_000_000,
    })

    const rows = await service.list(branch.bm, { period: Q3 })
    const unit = rows.find((row) => row.scope === 'unit')
    const people = rows.filter((row) => row.scope === 'user')

    expect(unit?.amount).toBe(10_000_000_000)
    expect(people.reduce((total, row) => total + row.amount, 0)).toBe(5_000_000_000)
  })
})

describe('who may set one', () => {
  it('is the branch manager', async () => {
    const branch = await makeBranch()
    await expect(
      service.set(branch.bm, { scope: 'unit', period: Q3, metric: 'value', amount: 1_000_000_000 }),
    ).resolves.toBeDefined()
  })

  /** A team lead who wants a different number argues for it, rather than
   *  editing it. */
  it('is not a team lead', async () => {
    const branch = await makeBranch()

    await expect(
      service.set(branch.leadRb, {
        scope: 'user',
        ownerId: branch.saleRb.id,
        period: Q3,
        metric: 'value', amount: 1_000_000_000,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('is not a salesperson setting their own', async () => {
    const branch = await makeBranch()

    await expect(
      service.set(branch.saleRb, {
        scope: 'user',
        ownerId: branch.saleRb.id,
        period: Q3,
        amount: 1,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('is also the admin, so a demo can be set up', async () => {
    const branch = await makeBranch()
    const admin = await makeUser({ role: 'admin', unitId: branch.unit.id })

    await expect(
      service.set(admin, { scope: 'unit', period: Q3, metric: 'value', amount: 1_000_000_000 }),
    ).resolves.toBeDefined()
  })
})

describe('what it refuses', () => {
  it('refuses a unit number that also names a person', async () => {
    const branch = await makeBranch()

    await expect(
      service.set(branch.bm, {
        scope: 'unit',
        ownerId: branch.saleRb.id,
        period: Q3,
        amount: 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('refuses a personal number with nobody attached', async () => {
    const branch = await makeBranch()

    await expect(
      service.set(branch.bm, { scope: 'user', period: Q3, amount: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('refuses a personal number narrowed to a segment', async () => {
    const branch = await makeBranch()

    await expect(
      service.set(branch.bm, {
        scope: 'user',
        ownerId: branch.saleRb.id,
        segment: 'rb',
        period: Q3,
        amount: 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('refuses a number for someone in another branch', async () => {
    const here = await makeBranch()
    const elsewhere = await makeBranch()

    await expect(
      service.set(here.bm, {
        scope: 'user',
        ownerId: elsewhere.saleRb.id,
        period: Q3,
        amount: 1,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  /** An admin holds no book, so a number against one would sit in the branch
   *  total with nobody able to deliver it.
   *
   *  Two different refusals reach the same outcome, and both are worth having.
   *  A branch manager is stopped at the scope, because the technical account
   *  is not in the sales tree they manage; an admin gets past that and is
   *  stopped by the rule itself. */
  it('refuses a number for the technical account, out of scope for a branch manager', async () => {
    const branch = await makeBranch()
    const admin = await makeUser({ role: 'admin', unitId: branch.unit.id })

    await expect(
      service.set(branch.bm, { scope: 'user', ownerId: admin.id, period: Q3, amount: 1 }),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('refuses a number for the technical account even when an admin asks', async () => {
    const branch = await makeBranch()
    const admin = await makeUser({ role: 'admin', unitId: branch.unit.id })

    await expect(
      service.set(admin, { scope: 'user', ownerId: admin.id, period: Q3, amount: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })
})

describe('who may see what', () => {
  async function allocated() {
    const branch = await makeBranch()
    await service.set(branch.bm, { scope: 'unit', period: Q3, metric: 'value', amount: 10_000_000_000 })
    await service.set(branch.bm, {
      scope: 'user',
      ownerId: branch.saleRb.id,
      period: Q3,
      metric: 'value', amount: 2_000_000_000,
    })
    await service.set(branch.bm, {
      scope: 'user',
      ownerId: branch.saleSse.id,
      period: Q3,
      metric: 'value', amount: 3_000_000_000,
    })
    return branch
  }

  it('gives the branch manager the whole unit', async () => {
    const branch = await allocated()
    expect(await service.list(branch.bm, { period: Q3 })).toHaveLength(3)
  })

  /** Knowing what the branch is carrying is not privileged, and hiding it
   *  would make a salesperson's own share look arbitrary. */
  it('shows everyone the unit number', async () => {
    const branch = await allocated()

    const rows = await service.list(branch.saleRb, { period: Q3 })
    expect(rows.some((row) => row.scope === 'unit')).toBe(true)
  })

  it('shows a salesperson their own number and not a peer’s', async () => {
    const branch = await allocated()

    const rows = await service.list(branch.saleRb, { period: Q3 })
    const personal = rows.filter((row) => row.scope === 'user')

    expect(personal.map((row) => row.ownerId)).toEqual([branch.saleRb.id])
  })

  it('shows a team lead their own people', async () => {
    const branch = await allocated()

    const rows = await service.list(branch.leadRb, { period: Q3 })
    const personal = rows.filter((row) => row.scope === 'user')

    expect(personal.map((row) => row.ownerId)).toEqual([branch.saleRb.id])
  })

  it('stops at the branch boundary', async () => {
    const here = await allocated()
    const elsewhere = await makeBranch()
    await service.set(elsewhere.bm, { scope: 'unit', period: Q3, metric: 'value', amount: 99_000_000_000 })

    const rows = await service.list(here.bm, { period: Q3 })
    expect(rows.every((row) => row.unitId === here.unit.id)).toBe(true)
  })

  it('gives an admin everything', async () => {
    const here = await allocated()
    const elsewhere = await makeBranch()
    await service.set(elsewhere.bm, { scope: 'unit', period: Q3, metric: 'value', amount: 99_000_000_000 })
    const admin = await makeUser({ role: 'admin', unitId: here.unit.id })

    expect(await service.list(admin, { period: Q3 })).toHaveLength(4)
  })

  it('filters by period and by scope', async () => {
    const branch = await allocated()
    await service.set(branch.bm, { scope: 'unit', period: '2026-Q4', metric: 'value', amount: 1_000_000_000 })

    expect(await service.list(branch.bm, { period: Q3 })).toHaveLength(3)
    expect(await service.list(branch.bm, { scope: 'unit' })).toHaveLength(2)
  })
})

describe('removing one', () => {
  it('lets the branch manager take a number back', async () => {
    const branch = await makeBranch()
    const target = await service.set(branch.bm, {
      scope: 'unit',
      period: Q3,
      metric: 'value', amount: 1_000_000_000,
    })

    await service.remove(branch.bm, target.id)
    expect(await service.list(branch.bm)).toEqual([])
  })

  it('does not let a team lead remove one', async () => {
    const branch = await makeBranch()
    const target = await service.set(branch.bm, {
      scope: 'unit',
      period: Q3,
      metric: 'value', amount: 1_000_000_000,
    })

    await expect(service.remove(branch.leadRb, target.id)).rejects.toBeInstanceOf(
      ForbiddenException,
    )
  })

  it('does not let a branch manager reach into another branch', async () => {
    const here = await makeBranch()
    const elsewhere = await makeBranch()
    const theirs = await service.set(elsewhere.bm, {
      scope: 'unit',
      period: Q3,
      metric: 'value', amount: 1_000_000_000,
    })

    await expect(service.remove(here.bm, theirs.id)).rejects.toBeInstanceOf(NotFoundException)
  })
})

describe('what a target measures', () => {
  /** The branch runs on a conversion rate — every report says "6% CR" — so a
   *  target with nothing said about it is one of those. */
  it('is a conversion rate unless told otherwise', async () => {
    const branch = await makeBranch()
    const set = await service.set(branch.bm, {
      scope: 'unit',
      period: '2026-Q3',
      amount: 600,
    })

    expect(set.metric).toBe('cr_rate')
    expect(set.amount).toBe(600)
  })

  /** A rate says nothing about whether the deals were worth having, so the
   *  three live side by side rather than replacing one another. */
  it('keeps a rate, a deal count and a money number apart', async () => {
    const branch = await makeBranch()

    await service.set(branch.bm, { scope: 'unit', period: '2026-Q3', amount: 600 })
    await service.set(branch.bm, {
      scope: 'unit',
      period: '2026-Q3',
      metric: 'deals',
      amount: 284,
    })
    await service.set(branch.bm, {
      scope: 'unit',
      period: '2026-Q3',
      metric: 'value',
      amount: 10_000_000_000,
    })

    const all = await service.list(branch.bm, { period: '2026-Q3' })
    expect(all).toHaveLength(3)
    expect(all.map((row) => row.metric).sort()).toEqual(['cr_rate', 'deals', 'value'])
  })

  it('replaces only the number for the same metric', async () => {
    const branch = await makeBranch()
    await service.set(branch.bm, { scope: 'unit', period: '2026-Q3', amount: 600 })
    await service.set(branch.bm, {
      scope: 'unit',
      period: '2026-Q3',
      metric: 'deals',
      amount: 284,
    })

    await service.set(branch.bm, { scope: 'unit', period: '2026-Q3', amount: 700 })

    const all = await service.list(branch.bm, { period: '2026-Q3' })
    expect(all).toHaveLength(2)
    expect(all.find((row) => row.metric === 'cr_rate')?.amount).toBe(700)
    expect(all.find((row) => row.metric === 'deals')?.amount).toBe(284)
  })

  /** A typo that reaches a report makes every gap on it negative. The
   *  database refuses it too; saying so here gets the caller a sentence
   *  rather than a constraint name. */
  it('refuses a conversion target above a hundred percent', async () => {
    const branch = await makeBranch()

    await expect(
      service.set(branch.bm, { scope: 'unit', period: '2026-Q3', amount: 10_001 }),
    ).rejects.toThrow(BadRequestException)

    /** Exactly a hundred percent is absurd but not a typo. */
    const perfect = await service.set(branch.bm, {
      scope: 'unit',
      period: '2026-Q3',
      amount: 10_000,
    })
    expect(perfect.amount).toBe(10_000)
  })

  /** The bound belongs to the rate, not to the column: a money target of ten
   *  billion đồng is an ordinary number. */
  it('lets a money target past the rate’s ceiling', async () => {
    const branch = await makeBranch()
    const money = await service.set(branch.bm, {
      scope: 'unit',
      period: '2026-Q3',
      metric: 'value',
      amount: 10_000_000_000,
    })

    expect(money.amount).toBe(10_000_000_000)
  })

  it('filters a list down to one metric', async () => {
    const branch = await makeBranch()
    await service.set(branch.bm, { scope: 'unit', period: '2026-Q3', amount: 600 })
    await service.set(branch.bm, {
      scope: 'unit',
      period: '2026-Q3',
      metric: 'value',
      amount: 10_000_000_000,
    })

    const rates = await service.list(branch.bm, { metric: 'cr_rate' })
    expect(rates).toHaveLength(1)
    expect(rates[0].amount).toBe(600)
  })
})
