import { describe, expect, it } from 'vitest'
import { ROLES, type Role, type User } from '../db/schema'
import { systemPrompt } from './prompt'

/** A prompt cannot be unit-tested for whether it produces good advice — that
 *  needs a model and a judgement. What *can* be pinned is the structure the
 *  four roles depend on, and one rule that matters more than the rest: the
 *  branch manager is never told how to write, because they cannot.
 *
 *  These are cheap and they catch the two ways this file goes wrong: a role
 *  added to the schema and forgotten here, and the read-only rule quietly
 *  coming back with a copy-paste. */

function person(role: Role, extra: Partial<User> = {}): User {
  return {
    id: `usr_${role}`,
    name: 'Hải',
    title: 'Chuyên viên khách hàng cá nhân',
    employeeCode: 'NV0006',
    role,
    ...extra,
  } as User
}

describe('the system prompt', () => {
  it('gives every role in the schema a job of its own', () => {
    const jobs = ROLES.map((role) => {
      const text = systemPrompt(person(role))
      const start = text.indexOf('## Việc của bạn ở đây')
      expect(start, role).toBeGreaterThan(-1)
      return text.slice(start, text.indexOf('## Quy tắc về số liệu'))
    })

    expect(new Set(jobs).size).toBe(ROLES.length)
  })

  it('carries the person into it without asking for it to be read back', () => {
    const text = systemPrompt(person('sale', { name: 'Hà' }))

    expect(text).toContain('Hà')
    expect(text).toContain('không phải thứ để nói lại cho họ nghe')
  })

  /** The one rule in here that mirrors a real permission. A branch manager has
   *  no write tools at all — `mayWrite` in tools.ts — so a section explaining
   *  the approval card would describe a button that is not there. */
  describe('what a branch manager is told about writing', () => {
    const text = systemPrompt(person('bm', { title: 'Giám đốc chi nhánh' }))

    it('says the account only reads', () => {
      expect(text).toContain('## Không ghi vào hệ thống')
      expect(text).toContain('chỉ đọc')
    })

    it('never mentions the write tools or the approval card', () => {
      for (const tool of [
        'record_signal',
        'draft_opportunity',
        'set_next_action',
        'update_lead_fields',
      ]) {
        expect(text, tool).not.toContain(tool)
      }
      expect(text).not.toContain('Bốn tool ghi')
    })
  })

  describe('what everybody else is told about writing', () => {
    for (const role of ['sale', 'team_lead', 'admin'] as const) {
      it(`tells a ${role} that calling the tool is how permission is asked`, () => {
        const text = systemPrompt(person(role))

        expect(text).toContain('## Khi cần ghi vào hệ thống')
        expect(text).toContain('record_signal')
        expect(text).toContain('Bốn tool ghi')
      })
    }
  })

  /** The salesperson's half is the one that was asked for by name, and the one
   *  that goes wrong quietly: a prompt that says "đưa ra lời khuyên hữu ích"
   *  produces advice about advice. It has to name the fields. */
  describe('the salesperson’s half', () => {
    const text = systemPrompt(person('sale'))

    it('points at the customer record rather than at the branch figures', () => {
      for (const field of ['currentProducts', 'attributes', 'blockerCode', 'missingInfo']) {
        expect(text, field).toContain(field)
      }
      expect(text).toContain('get_customer_signals')
    })

    /** Both are free text in this schema, so a prompt that implies fixed codes
     *  or fixed keys sends the model looking for something that is not there.
     *  This was wrong in the first draft. */
    it('warns that the loose fields are loose', () => {
      expect(text).toContain('chữ tự do')
      expect(text).toContain('khoá khác nhau')
      expect(text).toContain('list_customer_facets')
    })

    /** A made-up interest rate inside a bank is not a small mistake. */
    it('forbids inventing product terms', () => {
      expect(text).toContain('Không bịa số của sản phẩm')
      expect(text).toContain('Lãi suất')
    })
  })

  describe('the manager halves', () => {
    it('sends a team lead to the aggregates, not to one customer', () => {
      const text = systemPrompt(person('team_lead', { title: 'Trưởng nhóm' }))

      expect(text).toContain('get_by_owner')
      expect(text).toContain('Đừng tư vấn hộ khách hàng')
    })

    it('sends a branch manager to the forecast and warns about the pipeline figure', () => {
      const text = systemPrompt(person('bm', { title: 'Giám đốc chi nhánh' }))

      expect(text).toContain('get_forecast')
      expect(text).toContain('pipeline.worth')
      expect(text).toContain('không** phải kết quả của kỳ này')
    })

    it('tells an admin to answer about the system, not about performance', () => {
      const text = systemPrompt(person('admin', { title: 'Quản trị hệ thống' }))

      expect(text).toContain('Đừng nhận định thay người kinh doanh')
      expect(text).toContain('toàn chi nhánh')
    })
  })

  /** A salesperson reading `blockerCode` in a sentence thinks they are looking
   *  at an error. The rule is stated twice on purpose — once beside the field
   *  list that seeds the vocabulary, once as a translation table — because
   *  stating it only at the end of the prompt did not hold. */
  describe('the rule against printing field names', () => {
    for (const role of ROLES) {
      it(`gives a ${role} the translation table`, () => {
        const text = systemPrompt(person(role))

        expect(text).toContain('Tên trường trong dữ liệu là để bạn đọc, không phải để in ra')
        expect(text).toContain('hạn xử lý')
        expect(text).toContain('điểm vướng')
        /** The parenthetical gloss was how it got round the rule. */
        expect(text).toContain('Kể cả trong ngoặc đơn')
      })
    }

    it('repeats it where the salesperson’s fields are listed', () => {
      const text = systemPrompt(person('sale'))
      const job = text.slice(
        text.indexOf('## Việc của bạn ở đây'),
        text.indexOf('## Quy tắc về số liệu'),
      )

      expect(job).toContain('để bạn tra')
    })
  })

  /** The schema constrains the column to four values, so this cannot happen —
   *  but a cast would have hidden the day a fifth is added to the constraint
   *  and not to this file. */
  it('falls back to a real job for a role it does not know', () => {
    const text = systemPrompt(person('auditor' as Role))
    expect(text).toContain('## Việc của bạn ở đây')
  })
})
