import type Anthropic from '@anthropic-ai/sdk'
import { startObservation } from '@langfuse/tracing'
import { claude, SEARCH_MODEL } from './claude'
import { LANGFUSE_ENABLED } from './tracing'
import { usageFor } from './usage'

/** Reading one page the person pointed at, once they have said yes.
 *
 *  The same shape as `searchWeb`: `fetch_url` is an `ask` tool, the card shows
 *  the exact link, and nothing is opened until somebody presses the button.
 *
 *  The page is fetched by Anthropic's server-side tool, not by this server.
 *  That is a security decision, not a convenience. A fetch from here would run
 *  inside the compose network, where `http://files:8333`, `http://db:5432` and
 *  the Langfuse containers answer — so a link the model was talked into, or a
 *  person pasted by mistake, could read the bank's own storage back into a
 *  chat. Fetched from Anthropic's side, the request starts on the public
 *  internet and can reach nothing that is not already public. */

export type WebFetchResult = {
  url: string
  /** The page's own title, when it had one. */
  title: string | null
  /** What the page says, in a few sentences, with nothing added. */
  summary: string
  /** Set when the page could not be read — blocked, not found, too large. */
  failed: string | null
}

/** A page is read once; a second fetch is the model following links around
 *  the site, which nobody approved. */
const MAX_FETCHES = 1

/** Enough for a company's home or about page; a long page is cut, not paid
 *  for in full. */
const MAX_CONTENT_TOKENS = 15_000

const FETCH_PROMPT = `Bạn đọc một trang web cho nhân viên một ngân hàng và tóm tắt lại.

Đọc đúng trang được đưa, rồi tóm tắt trong 4-8 câu tiếng Việt những gì trang nói: doanh nghiệp là ai, làm gì, quy mô, sản phẩm hay dịch vụ, địa chỉ và liên hệ nếu có, tin tức hay mốc thời gian nổi bật. Chỉ nói điều có trên trang; không có thì nói thẳng. Không suy đoán, không đưa lời khuyên, không bịa số.`

/** Only a web address a browser would open. Anything else — `file:`, `ftp:`,
 *  `javascript:`, a bare host — is refused before a card is drawn. */
export function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.includes('.')
  } catch {
    return false
  }
}

export async function fetchUrl(url: string): Promise<WebFetchResult> {
  const reply = await claude().messages.create({
    model: SEARCH_MODEL,
    max_tokens: 1500,
    system: FETCH_PROMPT,
    /** Forced, because left to choose, the model answered about a well-known
     *  site from memory without opening it — measured live. For a customer's
     *  page that would be a guess dressed as a reading. */
    tool_choice: { type: 'any' },
    tools: [
      {
        type: 'web_fetch_20250910',
        name: 'web_fetch',
        max_uses: MAX_FETCHES,
        max_content_tokens: MAX_CONTENT_TOKENS,
      },
    ],
    /** The address has to appear in the conversation for the tool to be
     *  allowed to open it; this is that conversation. */
    messages: [{ role: 'user', content: `Đọc và tóm tắt trang: ${url}` }],
  })

  const result = digestFetch(url, reply)
  trace(url, reply, result)
  return result
}

/** Pulls the page's title and the summary out of a reply. Separate from the
 *  request so it can be tested against a fixture. */
export function digestFetch(url: string, reply: Pick<Anthropic.Message, 'content'>): WebFetchResult {
  let title: string | null = null
  let failed: string | null = null
  const words: string[] = []

  for (const block of reply.content) {
    if (block.type === 'web_fetch_tool_result') {
      /** Words before the fetch are the model announcing it, not findings. */
      words.length = 0
      if (block.content.type === 'web_fetch_result') {
        title = block.content.content.title ?? null
      } else {
        failed = block.content.error_code
      }
    } else if (block.type === 'server_tool_use') {
      words.length = 0
    } else if (block.type === 'text') {
      words.push(block.text)
    }
  }

  return {
    url,
    title,
    summary: failed
      ? `Không đọc được trang (${failed}).`
      : words.join('').trim() || 'Trang không có nội dung đọc được.',
    failed,
  }
}

function trace(url: string, reply: Anthropic.Message, result: WebFetchResult) {
  if (!LANGFUSE_ENABLED) return
  startObservation(
    'web-fetch',
    {
      model: reply.model,
      input: url,
      output: result,
      usageDetails: usageFor(reply.usage),
    },
    { asType: 'generation' },
  ).end()
}
