import type Anthropic from '@anthropic-ai/sdk'
import { startObservation } from '@langfuse/tracing'
import { claude, SEARCH_MODEL } from './claude'
import { LANGFUSE_ENABLED } from './tracing'

/** Looking something up outside the system, once a person has said yes.
 *
 *  The assistant never searches on its own. It proposes a query through
 *  `search_web`, which is an `ask` tool like the writes: the card shows the
 *  exact words that would leave the building, and nothing does until somebody
 *  presses the button. That is the whole design. A query is the one place a
 *  customer's name can go to a third party, and the person who knows whether
 *  that is acceptable is the one looking at the card, not the model.
 *
 *  The search itself is a separate, small request — Haiku with Anthropic's
 *  server-side search tool — rather than the search tool handed to the main
 *  loop, because a server tool in the main loop runs the moment the model
 *  decides to, with no point at which anybody can be asked. */

export type WebSearchResult = {
  query: string
  /** What the pages said, in a few sentences, with nothing added. */
  summary: string
  /** The pages the summary rests on — cited ones first, so the card links to
   *  what was actually used rather than to everything the search returned. */
  sources: Array<{ title: string; url: string }>
  searches: number
}

const MAX_SOURCES = 6

/** A few searches are enough to answer one question; more is the model
 *  rummaging, paid for per search. */
const MAX_SEARCHES = 3

const SEARCH_PROMPT = `Bạn tra cứu thông tin công khai trên mạng cho nhân viên một ngân hàng.

Tìm theo đúng yêu cầu, rồi tóm tắt những gì các trang nói trong 3-6 câu tiếng Việt. Chỉ nói điều có trong kết quả tìm kiếm; không có thì nói thẳng là không tìm thấy. Ghi rõ mốc thời gian nếu trang có. Không suy đoán, không đưa lời khuyên, không bịa số.`

/** A phone, ID card or account number written into a query.
 *
 *  Checked on the proposal, so the model is told to rephrase before a card is
 *  ever drawn. Nine digits or more, ignoring the spaces, dots and dashes people
 *  put in numbers — which catches a phone number, a CCCD and an account number,
 *  and lets a year or a price through. The card is still the real guard; this
 *  is for the case where the person approves without reading closely. */
export function hasPersonalNumber(query: string): boolean {
  return /\d{9,}/.test(query.replace(/[\s.\-()+]/g, ''))
}

export async function searchWeb(query: string): Promise<WebSearchResult> {
  const reply = await claude().messages.create({
    model: SEARCH_MODEL,
    max_tokens: 2048,
    system: SEARCH_PROMPT,
    tools: [
      {
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: MAX_SEARCHES,
        /** No `user_location`: the API refuses country code VN outright
         *  ("Country code VN is not supported"), and a Vietnamese query
         *  already finds Vietnamese pages. */
      },
    ],
    messages: [{ role: 'user', content: query }],
  })

  const result = digest(query, reply)
  trace(query, reply, result)
  return result
}

/** Pulls the answer and its sources out of a reply. Separate from the request
 *  so it can be tested against a fixture rather than a live search. */
export function digest(query: string, reply: Pick<Anthropic.Message, 'content'>): WebSearchResult {
  const cited: Array<{ title: string; url: string }> = []
  const found: Array<{ title: string; url: string }> = []
  const words: string[] = []
  let searches = 0

  for (const block of reply.content) {
    if (block.type === 'text') {
      words.push(block.text)
      for (const citation of block.citations ?? []) {
        if (citation.type === 'web_search_result_location') {
          cited.push({ title: citation.title ?? citation.url, url: citation.url })
        }
      }
    } else if (block.type === 'server_tool_use') {
      searches += 1
    } else if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const hit of block.content) found.push({ title: hit.title, url: hit.url })
    }
  }

  const seen = new Set<string>()
  const sources = [...cited, ...found].filter((source) => {
    if (seen.has(source.url)) return false
    seen.add(source.url)
    return true
  })

  return {
    query,
    /** The text arrives split at every citation, so the pieces are joined
     *  back without separators — they are one paragraph cut into spans. */
    summary: words.join('').trim() || 'Không tìm thấy thông tin phù hợp.',
    sources: sources.slice(0, MAX_SOURCES),
    searches,
  }
}

/** The search is billed like any other request, and it is the one that runs
 *  outside the chat loop, so it gets its own generation in the trace. */
function trace(query: string, reply: Anthropic.Message, result: WebSearchResult) {
  if (!LANGFUSE_ENABLED) return
  startObservation(
    'web-search',
    {
      model: reply.model,
      input: query,
      output: result,
      usageDetails: {
        input: reply.usage.input_tokens,
        output: reply.usage.output_tokens,
      },
      metadata: { searches: result.searches },
    },
    { asType: 'generation' },
  ).end()
}
