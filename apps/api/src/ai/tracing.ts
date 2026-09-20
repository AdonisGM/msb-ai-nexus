import { LangfuseSpanProcessor } from '@langfuse/otel'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { LANGFUSE_ENABLED } from '../env'

/** Where every AI turn goes to be counted.
 *
 *  Two things are being tracked and they are not the same thing. The **audit**
 *  — what the assistant read and wrote, for whom, who approved it — lives in
 *  `tool_calls` and `messages`, in this database, because that is what the
 *  bank asks for and it has to join against customers and leads. This is the
 *  other half: tokens, cost, latency, which model, which prompt. Engineering's
 *  question, not compliance's.
 *
 *  Off unless keys are configured. A missing key leaves the assistant working
 *  exactly as before and sends nothing anywhere — the same rule the Anthropic
 *  key follows, for the same reason: a demo machine should not depend on a
 *  service nobody set up.
 *
 *  Note for later: the prompts carry customer names and notes a salesperson
 *  typed. On Langfuse Cloud that data leaves this machine. `LANGFUSE_BASE_URL`
 *  is the only thing that decides — pointing it at a self-hosted instance
 *  changes nothing else in the code. */

let sdk: NodeSDK | null = null

export function startTracing(): void {
  if (!LANGFUSE_ENABLED || sdk) return

  /** Only the Langfuse processor, and no auto-instrumentation: the point is
   *  the model calls, not every HTTP request and database query the API
   *  makes. Those are already in the logs and would bury the ones that cost
   *  money. */
  sdk = new NodeSDK({ spanProcessors: [new LangfuseSpanProcessor()] })
  sdk.start()
}

/** Flushes what is buffered. Called when the process is shutting down, because
 *  spans are batched — without it the last few turns of a session are lost,
 *  which is exactly the ones somebody is usually looking for. */
export async function stopTracing(): Promise<void> {
  await sdk?.shutdown()
  sdk = null
}

export { LANGFUSE_ENABLED }
