import Anthropic from '@anthropic-ai/sdk'
import { ServiceUnavailableException } from '@nestjs/common'
import { AI_ENABLED, ANTHROPIC_API_KEY } from '../env'

/** One client, and one place that decides which model answers.
 *
 *  Kept apart from the services that use it so a model change is one edit
 *  rather than a search, and so nothing else in the API imports the SDK
 *  directly. */

/** The assistant's model.
 *
 *  Sonnet 5: the work is reading a file that is already assembled and choosing
 *  which of twenty-one narrow tools to call, not open-ended reasoning. A
 *  salesperson waiting in front of a customer notices two seconds; they do not
 *  notice the difference between two good answers. */
export const MODEL = 'claude-sonnet-5'

/** Titles are three words about a conversation that already happened. Haiku
 *  answers in well under a second and costs almost nothing, and nobody has
 *  ever read a title and wished it were cleverer. */
export const TITLE_MODEL = 'claude-haiku-4-5-20251001'

/** Web searches, once a person has approved one. The work is reading a few
 *  pages and saying what they say — Haiku does that well, and the main model's
 *  judgement is spent afterwards, on what the result means for the customer. */
export const SEARCH_MODEL = TITLE_MODEL

/** Adaptive, not a token budget: `budget_tokens` is rejected outright by the
 *  5 series, and the model is better placed than we are to judge how much a
 *  given question deserves. */
export const THINKING = { type: 'adaptive' } as const

/** How hard to work on a turn.
 *
 *  Medium. This is a different dial from `thinking` and lives on
 *  `output_config`, which is easy to miss — `thinking.adaptive` decides
 *  whether to reason at all, `effort` decides how much of it to spend.
 *
 *  Medium suits the shape of the work: most turns are one or two tool calls
 *  and a short answer about what came back. The turns that deserve more —
 *  reading a customer's whole file and saying what is missing from it — are
 *  the ones adaptive thinking already stretches for. */
export const OUTPUT_CONFIG = { effort: 'medium' } as const

let client: Anthropic | null = null

/** The shared client, or a 503 that says why.
 *
 *  Every caller goes through here rather than constructing its own, so there
 *  is exactly one answer to "is the assistant configured" and it is the same
 *  one on every endpoint. */
export function claude(): Anthropic {
  if (!AI_ENABLED) {
    throw new ServiceUnavailableException('ai_not_configured')
  }
  client ??= new Anthropic({ apiKey: ANTHROPIC_API_KEY })
  return client
}

export { AI_ENABLED }
