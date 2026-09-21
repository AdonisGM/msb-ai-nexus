import type Anthropic from '@anthropic-ai/sdk'
import { startObservation } from '@langfuse/tracing'
import { claude, SEARCH_MODEL } from './claude'
import { LANGFUSE_ENABLED } from './tracing'
import { usageFor } from './usage'

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
 *  rummaging, paid for per search. Four rather than three because a search by
 *  phone or email tries the social networks before the open web. */
const MAX_SEARCHES = 4

const SEARCH_PROMPT = `Bạn tra cứu thông tin công khai trên mạng cho nhân viên một ngân hàng.

Nếu yêu cầu có số điện thoại hoặc email, tìm trên mạng xã hội TRƯỚC — Facebook, LinkedIn, TikTok, Zalo OA, Instagram — bằng cách thêm "site:facebook.com", "site:linkedin.com"… vào truy vấn, đặt số điện thoại hoặc email trong ngoặc kép. Chưa có gì mới tìm trên web chung (trang doanh nghiệp, danh bạ, tin rao, báo).

Tìm theo đúng yêu cầu, rồi tóm tắt những gì các trang nói trong 3-6 câu tiếng Việt, nói rõ thông tin đến từ trang nào. Chỉ nói điều có trong kết quả tìm kiếm; không có thì nói thẳng là không tìm thấy. Một trang trùng số điện thoại chưa chắc là cùng người — nói rõ mức chắc chắn. Ghi rõ mốc thời gian nếu trang có. Không suy đoán, không đưa lời khuyên, không bịa số.`

/** An ID card or account number written into a query.
 *
 *  Phone numbers and emails are allowed — the branch chose to let the
 *  assistant look people and companies up by them, on the social networks
 *  first. What stays refused is the kind of number that finds nothing useful
 *  and should never leave the bank: a 12-digit CCCD, an account number.
 *
 *  Separators are ignored, so "0912 345 678" is read as the phone it is. A
 *  run of nine or more digits passes only if it has the shape of a Vietnamese
 *  phone: 0 plus nine or ten digits, or 84 plus nine or ten. Everything else
 *  that long is treated as an ID or an account. The card is still the real
 *  guard; this catches the approval pressed without reading. */
export function hasIdOrAccountNumber(query: string): boolean {
  const runs = query.replace(/[\s.\-()]/g, '').match(/\+?\d{9,}/g) ?? []
  return runs.some((run) => !/^(0|\+?84)\d{9,10}$/.test(run))
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
      /** Words before a search are the model announcing it ("Tôi sẽ tìm…"),
       *  not findings. Only what follows the last search is the answer. */
      words.length = 0
    } else if (block.type === 'web_search_tool_result') {
      words.length = 0
      if (Array.isArray(block.content)) {
        for (const hit of block.content) found.push({ title: hit.title, url: hit.url })
      }
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
      usageDetails: usageFor(reply.usage),
      /** The per-search fee is billed on top of tokens and Langfuse has no
       *  price for it, so the count is kept here to be multiplied by hand. */
      metadata: { searches: result.searches },
    },
    { asType: 'generation' },
  ).end()
}
