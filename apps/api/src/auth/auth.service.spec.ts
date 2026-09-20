import { UnauthorizedException } from '@nestjs/common'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, resetDb, testDb } from '../test/db'
import { TEST_PASSWORD, makeBranch, makeUser } from '../test/factories'
import { AuthService } from './auth.service'

const service = new AuthService(testDb)

beforeEach(resetDb)
afterAll(closeDb)

describe('signing in', () => {
  it('accepts the right code and password', async () => {
    const user = await makeUser({ code: 'SALE-RB-01' })
    expect((await service.login('SALE-RB-01', TEST_PASSWORD)).id).toBe(user.id)
  })

  it('stamps the last sign-in', async () => {
    const user = await makeUser({ code: 'SALE-RB-02' })
    expect(user.lastLoginAt).toBeNull()

    await service.login('SALE-RB-02', TEST_PASSWORD)
    const after = await service.login('SALE-RB-02', TEST_PASSWORD)
    expect(after.lastLoginAt).not.toBeNull()
  })

  /** Telling the caller which half was wrong is a gift to anyone guessing and
   *  helps a real user not at all — they retype both anyway. */
  it('gives the same refusal for a wrong password and a code that does not exist', async () => {
    await makeUser({ code: 'SALE-RB-03' })

    await expect(service.login('SALE-RB-03', 'wrong')).rejects.toThrow(UnauthorizedException)
    await expect(service.login('NOBODY-AT-ALL', TEST_PASSWORD)).rejects.toThrow(
      UnauthorizedException,
    )
  })

  it('refuses an account that has been switched off', async () => {
    await makeUser({ code: 'SALE-RB-04', active: false })
    await expect(service.login('SALE-RB-04', TEST_PASSWORD)).rejects.toThrow(
      UnauthorizedException,
    )
  })
})

describe('who an account reports to', () => {
  /** Sent with the session so a salesperson knows who signs off their wins
   *  and who is chasing them. `managerId` on its own is an opaque id no
   *  screen can render. */
  it('names the team lead above a salesperson', async () => {
    const branch = await makeBranch()
    const manager = await service.managerOf(branch.saleRb)

    expect(manager).toEqual({
      id: branch.leadRb.id,
      name: branch.leadRb.name,
      role: 'team_lead',
      title: branch.leadRb.title,
    })
  })

  it('names the branch manager above a team lead', async () => {
    const branch = await makeBranch()
    expect((await service.managerOf(branch.leadSse))?.id).toBe(branch.bm.id)
  })

  it('returns nothing for the two accounts with nobody above them', async () => {
    const branch = await makeBranch()
    const admin = await makeUser({ role: 'admin', unitId: branch.unit.id })

    expect(await service.managerOf(branch.bm)).toBeNull()
    expect(await service.managerOf(admin)).toBeNull()
  })
})
