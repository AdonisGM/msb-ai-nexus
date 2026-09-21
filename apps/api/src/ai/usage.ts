/** Token counts under the names Langfuse prices them by.
 *
 *  Its model table charges `input`, `output`, `cache_read_input_tokens` and
 *  `cache_creation_input_tokens`. Any other key is counted in the token total
 *  and priced at nothing — which is what `cacheReadTokens` and
 *  `cacheWriteTokens` were: every cached prefix, on every request, free. The
 *  dashboard showed $0.84 for traffic that cost $1.34. */
export function usageFor(usage: {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}) {
  return {
    input: usage.input_tokens,
    output: usage.output_tokens,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
  }
}
