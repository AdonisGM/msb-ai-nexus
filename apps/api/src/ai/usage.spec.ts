import { describe, expect, it } from 'vitest'
import { usageFor } from './usage'

/** Langfuse prices a generation by matching usage keys against its model
 *  table. A key it does not know is counted and priced at nothing, which is
 *  how every cached token went unbilled on the dashboard. */
describe('usage as Langfuse prices it', () => {
  it('uses the key names the model table charges for', () => {
    expect(
      usageFor({
        input_tokens: 1395,
        output_tokens: 437,
        cache_read_input_tokens: 9352,
        cache_creation_input_tokens: 120,
      }),
    ).toEqual({
      input: 1395,
      output: 437,
      cache_read_input_tokens: 9352,
      cache_creation_input_tokens: 120,
    })
  })

  it('reads a missing cache count as zero', () => {
    expect(usageFor({ input_tokens: 10, output_tokens: 2 })).toMatchObject({
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    })
  })
})
