import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import { digestFetch, isWebUrl } from './web-fetch'

/** The two pure halves of reading a page: which addresses may be opened at
 *  all, and what is taken from the reply. The fetch itself is Anthropic's. */

describe('which addresses may be opened', () => {
  it.each(['https://hoaphat.com.vn', 'http://example.com/a?b=1', ' https://sbv.gov.vn/vi/tin-tuc '])(
    'accepts %s',
    (url) => {
      expect(isWebUrl(url)).toBe(true)
    },
  )

  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'ftp://example.com', 'hoaphat.com.vn', 'http://localhost', 'mailto:a@b.vn', ''])(
    'refuses %s',
    (url) => {
      expect(isWebUrl(url)).toBe(false)
    },
  )
})

describe('reading a fetch reply', () => {
  const reply = (content: unknown[]) => ({ content }) as unknown as Pick<Anthropic.Message, 'content'>

  it('takes the page title and the summary written after reading it', () => {
    const result = digestFetch(
      'https://example.com',
      reply([
        { type: 'text', text: 'Tôi sẽ mở trang.' },
        { type: 'server_tool_use', id: 's1', name: 'web_fetch', input: { url: 'https://example.com' } },
        {
          type: 'web_fetch_tool_result',
          tool_use_id: 's1',
          content: {
            type: 'web_fetch_result',
            url: 'https://example.com',
            retrieved_at: null,
            content: { type: 'document', title: 'Example Domain', source: {}, citations: null },
          },
        },
        { type: 'text', text: 'Trang ví dụ dùng cho tài liệu.' },
      ]),
    )

    expect(result).toEqual({
      url: 'https://example.com',
      title: 'Example Domain',
      summary: 'Trang ví dụ dùng cho tài liệu.',
      failed: null,
    })
  })

  /** A blocked or missing page comes back as an error object where the page
   *  would be — said so, rather than summarised from nothing. */
  it('says so when the page could not be read', () => {
    const result = digestFetch(
      'https://x.vn',
      reply([
        { type: 'server_tool_use', id: 's1', name: 'web_fetch', input: {} },
        {
          type: 'web_fetch_tool_result',
          tool_use_id: 's1',
          content: { type: 'web_fetch_tool_result_error', error_code: 'url_not_accessible' },
        },
        { type: 'text', text: 'Theo hiểu biết của tôi, công ty này…' },
      ]),
    )

    expect(result.failed).toBe('url_not_accessible')
    expect(result.summary).toContain('Không đọc được trang')
    expect(result.summary).not.toContain('hiểu biết')
  })
})
