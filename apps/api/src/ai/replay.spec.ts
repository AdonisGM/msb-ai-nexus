import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import type { AttachmentRef } from './attachments.service'
import { FILE_TURNS, filesToLoad, REPLAY_TURNS, replay, type StoredTurn } from './replay'

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

  it('hollows out tool results that have fallen behind', () => {
    const rows = [...toolExchange('q1', 1), ...toolExchange('q2', 2), ...toolExchange('q3', 3)]
    const turns = replay(rows, new Map())

    expect((turns[2].content as Block[])[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 't1',
      content: expect.stringContaining('lược bớt'),
    })
    expect((turns[6].content as Block[])[0]).toMatchObject({ content: 'rows 2' })
  })

  it('leaves a string turn as a string', () => {
    const turns = replay([{ role: 'user', content: 'Tôi đã duyệt' }], new Map())
    expect(turns[0]).toEqual({ role: 'user', content: 'Tôi đã duyệt' })
  })
})
