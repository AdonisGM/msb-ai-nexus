import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import { digest, hasIdOrAccountNumber } from './web-search'

/** The two pure halves of a search: the check on what may be sent, and the
 *  reading of what came back. The request itself is Anthropic's. */

describe('an ID or account number in a query', () => {
  it.each([
    ['a CCCD', 'CCCD 001203004567'],
    ['a spaced CCCD', '001 203 004 567'],
    ['an account number', 'stk 19036548801012'],
    ['a nine-digit old ID', 'CMND 012345678'],
  ])('catches %s', (_, query) => {
    expect(hasIdOrAccountNumber(query)).toBe(true)
  })

  /** Allowed by the branch's choice: people and companies are looked up by
   *  phone, on the social networks first. */
  it.each([
    ['a mobile number', 'anh Hùng 0912345678'],
    ['a spaced mobile number', '"0912 345 678" facebook'],
    ['a dotted mobile number', '0912.345.678'],
    ['an international number', '+84 912 345 678'],
    ['a Hanoi landline', '024 3736 1234'],
    ['an email', 'an.nguyen@congty.vn'],
    ['a company name', 'Công ty CP Sản xuất Đại Dương'],
    ['a year', 'thông tư NHNN 2026'],
    ['a price', 'giá thép 15.500.000 đồng'],
  ])('lets through %s', (_, query) => {
    expect(hasIdOrAccountNumber(query)).toBe(false)
  })
})

describe('reading a search reply', () => {
  const reply = {
    content: [
      { type: 'text', text: 'Tôi sẽ tìm trên mạng xã hội trước.', citations: null },
      { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'x' } },
      {
        type: 'web_search_tool_result',
        tool_use_id: 's1',
        content: [
          { type: 'web_search_result', title: 'Báo A', url: 'https://a.vn/1', encrypted_content: '', page_age: null },
          { type: 'web_search_result', title: 'Báo B', url: 'https://b.vn/2', encrypted_content: '', page_age: null },
        ],
      },
      { type: 'text', text: 'Theo báo B, ', citations: null },
      {
        type: 'text',
        text: 'công ty mở nhà máy mới năm 2026.',
        citations: [
          { type: 'web_search_result_location', url: 'https://b.vn/2', title: 'Báo B', cited_text: '', encrypted_index: '' },
        ],
      },
    ],
  } as unknown as Pick<Anthropic.Message, 'content'>

  it('drops what the model said before searching', () => {
    expect(digest('q', reply).summary).not.toContain('Tôi sẽ tìm')
  })

  it('joins the text split at citations back into one paragraph', () => {
    expect(digest('q', reply).summary).toBe('Theo báo B, công ty mở nhà máy mới năm 2026.')
  })

  it('puts the cited pages first and lists each page once', () => {
    expect(digest('q', reply).sources).toEqual([
      { title: 'Báo B', url: 'https://b.vn/2' },
      { title: 'Báo A', url: 'https://a.vn/1' },
    ])
  })

  it('counts the searches it took', () => {
    expect(digest('q', reply).searches).toBe(1)
  })

  it('says so when nothing came back', () => {
    const result = digest('q', { content: [] } as unknown as Pick<Anthropic.Message, 'content'>)
    expect(result.summary).toBe('Không tìm thấy thông tin phù hợp.')
    expect(result.sources).toEqual([])
  })

  /** A failed search comes back as an error object where the list would be,
   *  not as a thrown error. */
  it('survives a search that returned an error instead of results', () => {
    const failed = {
      content: [
        { type: 'web_search_tool_result', tool_use_id: 's1', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } },
      ],
    } as unknown as Pick<Anthropic.Message, 'content'>
    expect(digest('q', failed).sources).toEqual([])
  })

  it('keeps at most six sources', () => {
    const many = {
      content: [
        {
          type: 'web_search_tool_result',
          tool_use_id: 's1',
          content: Array.from({ length: 10 }, (_, i) => ({
            type: 'web_search_result',
            title: `T${i}`,
            url: `https://x.vn/${i}`,
          })),
        },
      ],
    } as unknown as Pick<Anthropic.Message, 'content'>
    expect(digest('q', many).sources).toHaveLength(6)
  })
})
