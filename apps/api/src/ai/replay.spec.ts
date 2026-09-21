import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import type { AttachmentRef } from './attachments.service'
import {
  clockNote,
  contextNote,
  todayInVietnam,
  FILE_TURNS,
  filesToLoad,
  REPLAY_TURNS,
  replay,
  type ContextRef,
  type StoredTurn,
} from './replay'

type Block = Anthropic.Beta.Messages.BetaContentBlockParam

/** What the model is shown of a thread it has seen before.
 *
 *  Two things are dropped as a thread grows — old tool results and old files —
 *  and each is dropped on its own clock. Getting either wrong is expensive in
 *  one direction (paying for a PDF on every question) or confusing in the
 *  other (the model forgetting a photo it was asked about one line ago). */

function ref(id: string, name = `${id}.png`): AttachmentRef {
  return { type: 'attachment', id, kind: 'image', name, mime: 'image/png', size: 10 }
}

const image = (data: string): Block => ({
  type: 'image',
  source: { type: 'base64', media_type: 'image/png', data },
})

const said = (...content: unknown[]): StoredTurn => ({ role: 'user', content })
const answered = (text: string): StoredTurn => ({
  role: 'assistant',
  content: [{ type: 'text', text }],
})

/** One question that reached for a tool: four rows. */
function toolExchange(question: string, n: number): StoredTurn[] {
  return [
    said({ type: 'text', text: question }),
    { role: 'assistant', content: [{ type: 'tool_use', id: `t${n}`, name: 'get_funnel', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${n}`, content: `rows ${n}` }] },
    answered(`answer ${n}`),
  ]
}

describe('which files are loaded', () => {
  it('loads the files in the latest turn', () => {
    const rows = [said(ref('a'), { type: 'text', text: 'xem ảnh' })]
    expect(filesToLoad(rows)).toEqual(['a'])
  })

  it(`keeps a file through ${FILE_TURNS - 1} follow-up`, () => {
    const rows = [said(ref('a')), answered('một ảnh'), said({ type: 'text', text: 'dòng thứ hai?' })]
    expect(filesToLoad(rows)).toEqual(['a'])
  })

  it('lets a file go once the person has moved on', () => {
    const rows = [
      said(ref('a')),
      answered('một ảnh'),
      said({ type: 'text', text: 'dòng thứ hai?' }),
      answered('...'),
      said({ type: 'text', text: 'chuyện khác' }),
    ]
    expect(filesToLoad(rows)).toEqual([])
  })

  /** A question that sets off tool calls is several rows. Counting rows would
   *  drop the photo before the follow-up about it. */
  it('does not count the runner’s tool-result turns as the person speaking', () => {
    const rows = [said(ref('a')), answered('một ảnh'), ...toolExchange('so với tháng trước?', 1)]
    expect(filesToLoad(rows)).toEqual(['a'])
  })

  it('counts a plain-string turn, like an approval, as the person speaking', () => {
    const rows: StoredTurn[] = [
      said(ref('a')),
      answered('...'),
      { role: 'user', content: 'Tôi đã duyệt' },
      answered('...'),
      { role: 'user', content: 'tiếp' },
    ]
    expect(filesToLoad(rows)).toEqual([])
  })

  it('loads every file of a turn, in order', () => {
    expect(filesToLoad([said(ref('a'), ref('b'), { type: 'text', text: 'so sánh' })])).toEqual([
      'a',
      'b',
    ])
  })
})

describe('replaying files', () => {
  it('swaps a reference for the file’s bytes', () => {
    const turns = replay([said(ref('a'), { type: 'text', text: 'xem' })], new Map([['a', image('AAA')]]))
    const content = turns[0].content as Block[]

    expect(content[0]).toMatchObject({ type: 'image', source: { data: 'AAA' } })
    expect(content[1]).toEqual({ type: 'text', text: 'xem' })
  })

  it('replaces a file outside the window with a line naming it', () => {
    const rows = [
      said(ref('a', 'hop-dong.pdf')),
      answered('...'),
      said({ type: 'text', text: '1' }),
      answered('...'),
      said({ type: 'text', text: '2' }),
    ]
    /** Even if the bytes were loaded by mistake, they are not used. */
    const turns = replay(rows, new Map([['a', image('AAA')]]))
    const first = (turns[0].content as Block[])[0]

    expect(first).toMatchObject({ type: 'text', text: expect.stringContaining('hop-dong.pdf') })
  })

  /** A reference is never sent as-is: the API would refuse the whole request
   *  over a block type it has never heard of. */
  it('never sends a raw reference, even when the file failed to load', () => {
    const turns = replay([said(ref('a'))], new Map())
    const content = turns[0].content as Block[]

    expect(content.some((block) => (block.type as string) === 'attachment')).toBe(false)
    expect(content[0].type).toBe('text')
  })

  it('puts a cache breakpoint on the newest file and only there', () => {
    const rows = [
      said(ref('a')),
      answered('...'),
      said(ref('b'), { type: 'text', text: 'và ảnh này' }),
    ]
    const turns = replay(rows, new Map([['a', image('A')], ['b', image('B')]]))

    const marked = turns.flatMap((turn) =>
      (turn.content as Block[]).filter((block) => 'cache_control' in block && block.cache_control),
    )
    expect(marked).toHaveLength(1)
    expect(marked[0]).toMatchObject({ source: { data: 'B' } })
  })

  it('adds no breakpoint to a thread without files', () => {
    const turns = replay([said({ type: 'text', text: 'chào' }), answered('chào')], new Map())
    expect(JSON.stringify(turns)).not.toContain('cache_control')
  })

  /** The loaded block is shared with the map; marking it must not leak into
   *  the next request built from the same map. */
  it('does not mark the loaded block in place', () => {
    const files = new Map([['a', image('A')]])
    replay([said(ref('a'))], files)
    expect(files.get('a')).not.toHaveProperty('cache_control')
  })
})

describe('replaying tool results', () => {
  it(`keeps the last ${REPLAY_TURNS} exchanges’ worth of rows whole`, () => {
    const rows = toolExchange('q', 1)
    const turns = replay(rows, new Map())
    expect((turns[2].content as Block[])[0]).toMatchObject({ content: 'rows 1' })
  })

  const exchanges = (n: number) =>
    Array.from({ length: n }, (_, i) => toolExchange(`q${i + 1}`, i + 1)).flat()
  const resultOf = (turns: ReturnType<typeof replay>, n: number) =>
    (turns[(n - 1) * 4 + 2].content as Block[])[0] as { content: unknown }

  it('hollows nothing while the thread is short', () => {
    const turns = replay(exchanges(5), new Map())
    for (let n = 1; n <= 5; n++) expect(resultOf(turns, n).content).toBe(`rows ${n}`)
  })

  it('hollows the oldest block of exchanges once the thread has grown', () => {
    const turns = replay(exchanges(6), new Map())
    for (let n = 1; n <= 3; n++) {
      expect(resultOf(turns, n).content).toEqual(expect.stringContaining('lược bớt'))
    }
    for (let n = 4; n <= 6; n++) expect(resultOf(turns, n).content).toBe(`rows ${n}`)
  })

  /** The point of cutting in steps: turns 7 and 8 replay the same prefix
   *  turn 6 did, so it is read from cache rather than written again. */
  it('keeps the same cut for the next turns, so the prefix holds still', () => {
    const at6 = replay(exchanges(6), new Map())
    const at8 = replay(exchanges(8), new Map())
    expect(at8.slice(0, at6.length)).toEqual(at6)
  })

  it('moves the cut by a whole block when it moves', () => {
    const turns = replay(exchanges(9), new Map())
    expect(resultOf(turns, 6).content).toEqual(expect.stringContaining('lược bớt'))
    expect(resultOf(turns, 7).content).toBe('rows 7')
  })

  it('keeps the tool_result block itself, only its contents go', () => {
    const turns = replay(exchanges(6), new Map())
    expect(resultOf(turns, 1)).toMatchObject({ type: 'tool_result', tool_use_id: 't1' })
  })

  it('leaves a string turn as a string', () => {
    const turns = replay([{ role: 'user', content: 'Tôi đã duyệt' }], new Map())
    expect(turns[0]).toEqual({ role: 'user', content: 'Tôi đã duyệt' })
  })
})

describe('replaying what was on screen', () => {
  const customer: ContextRef = {
    type: 'context',
    kind: 'customer',
    id: 'cus_1',
    label: '"Công ty Đại Dương" (KH0001)',
  }
  const deal: ContextRef = { type: 'context', kind: 'opportunity', id: 'opp_1', label: 'CH0001' }

  /** The API has never heard of a `context` block and would refuse the whole
   *  request over one. */
  it('turns the reference into a line the model reads', () => {
    const turns = replay([said(customer, { type: 'text', text: 'khách này cần gì?' })], new Map())
    const content = turns[0].content as Block[]

    expect(content[0]).toEqual({ type: 'text', text: contextNote(customer) })
    expect(content[1]).toEqual({ type: 'text', text: 'khách này cần gì?' })
  })

  it('names the record and the tool that reads it', () => {
    expect(contextNote(customer)).toContain('cus_1')
    expect(contextNote(customer)).toContain('get_customer')
    expect(contextNote(deal)).toContain('opp_1')
    expect(contextNote(deal)).toContain('get_opportunity')
  })

  /** Unlike a file it is a line of text, so it costs nothing to keep — and
   *  "khách này" three turns later still has to mean the same customer. */
  it('keeps the note in old turns, where files are dropped', () => {
    const rows = [
      said(customer, { type: 'text', text: '1' }),
      answered('...'),
      said({ type: 'text', text: '2' }),
      answered('...'),
      said({ type: 'text', text: '3' }),
    ]
    const first = replay(rows, new Map())[0].content as Block[]
    expect(first[0]).toMatchObject({ type: 'text', text: expect.stringContaining('cus_1') })
  })

  it('does not count a context note as a file to load', () => {
    expect(filesToLoad([said(customer, { type: 'text', text: 'x' })])).toEqual([])
  })
})

describe('replaying cited answers', () => {
  /** A citation is an index into the documents of the request it came from.
   *  By the next turn the document may be a placeholder, and a dangling index
   *  is a request the API refuses. */
  it('sends the words of a cited answer without the citations', () => {
    const cited: StoredTurn = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Hạn mức là ' },
        {
          type: 'text',
          text: '2,4 tỷ',
          citations: [
            {
              type: 'page_location',
              cited_text: 'Hạn mức đề xuất: 2.4 tỷ',
              document_index: 0,
              document_title: 'hd.pdf',
              start_page_number: 1,
              end_page_number: 2,
            },
          ],
        },
      ],
    }

    const content = replay([cited], new Map())[0].content as Block[]
    expect(content).toEqual([
      { type: 'text', text: 'Hạn mức là ' },
      { type: 'text', text: '2,4 tỷ' },
    ])
  })
})

/** The date rides on each question so the model does not spend a round trip
 *  on `today` first. */
describe('the date on a question', () => {
  it('reads the day, the weekday and the period starts', () => {
    expect(clockNote('2026-09-22')).toBe(
      '[Hôm nay: thứ Ba 22/09/2026 (2026-09-22). Tháng này từ 2026-09-01, quý này từ 2026-07-01, năm nay từ 2026-01-01.]',
    )
  })

  it('starts the quarter on the right month', () => {
    expect(clockNote('2026-01-05')).toContain('quý này từ 2026-01-01')
    expect(clockNote('2026-06-30')).toContain('quý này từ 2026-04-01')
    expect(clockNote('2026-12-31')).toContain('quý này từ 2026-10-01')
  })

  /** The container runs in UTC; seven hours behind, 00:30 in Hà Nội is
   *  still yesterday there. */
  it('takes the date in Vietnam, not the server’s timezone', () => {
    expect(todayInVietnam(new Date('2026-09-21T17:30:00Z'))).toBe('2026-09-22')
    expect(todayInVietnam(new Date('2026-09-21T16:30:00Z'))).toBe('2026-09-21')
  })

  it('replays the stored date as the same line every time', () => {
    const row = said({ type: 'clock', date: '2026-09-22' }, { type: 'text', text: 'tháng này?' })
    const first = replay([row], new Map())
    const again = replay([row, answered('...'), said({ type: 'text', text: 'x' })], new Map())
    expect(again[0]).toEqual(first[0])
    expect((first[0].content as Block[])[0]).toEqual({ type: 'text', text: clockNote('2026-09-22') })
  })
})
