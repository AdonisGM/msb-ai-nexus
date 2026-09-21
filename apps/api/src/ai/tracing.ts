import { Logger } from '@nestjs/common'
import { LangfuseSpanProcessor } from '@langfuse/otel'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import type { ExportResult, ExportResultCode } from '@opentelemetry/core'
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base'
import { NodeSDK } from '@opentelemetry/sdk-node'
import {
  LANGFUSE_BASE_URL,
  LANGFUSE_ENABLED,
  LANGFUSE_PUBLIC_KEY,
  LANGFUSE_SECRET_KEY,
} from '../env'

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

const log = new Logger('Tracing')

let sdk: NodeSDK | null = null

export function startTracing(): void {
  if (sdk) return

  if (!LANGFUSE_ENABLED) {
    /** Said out loud, because the alternative is a container that looks
     *  perfectly healthy and quietly measures nothing. A deploy where the
     *  keys never reached the process has already happened once, and the only
     *  symptom was an empty dashboard somebody noticed days later. */
    log.log('Không bật — thiếu LANGFUSE_PUBLIC_KEY hoặc LANGFUSE_SECRET_KEY')
    return
  }

  /** Only the Langfuse processor, and no auto-instrumentation: the point is
   *  the model calls, not every HTTP request and database query the API
   *  makes. Those are already in the logs and would bury the ones that cost
   *  money. */
  sdk = new NodeSDK({
    spanProcessors: [new LangfuseSpanProcessor({ exporter: guarded(langfuseExporter()) })],
  })
  sdk.start()
  log.log(`Gửi vết về ${LANGFUSE_BASE_URL}`)
}

/** Flushes what is buffered. Called when the process is shutting down, because
 *  spans are batched — without it the last few turns of a session are lost,
 *  which is exactly the ones somebody is usually looking for. */
export async function stopTracing(): Promise<void> {
  await sdk?.shutdown()
  sdk = null
}

/** The exporter `LangfuseSpanProcessor` would have built for itself.
 *
 *  Built here only because `exporter` is the one way to get a guard around
 *  it. The URL and the auth header are copied from that constructor, so they
 *  are the single thing in this file that can drift when the SDK is upgraded
 *  — and the drift would be loud rather than silent: every batch rejected,
 *  and `guarded` saying so in the log. */
function langfuseExporter(): SpanExporter {
  const credentials = Buffer.from(`${LANGFUSE_PUBLIC_KEY}:${LANGFUSE_SECRET_KEY}`).toString(
    'base64',
  )

  return new OTLPTraceExporter({
    url: `${LANGFUSE_BASE_URL.replace(/\/+$/, '')}/api/public/otel/v1/traces`,
    headers: {
      Authorization: `Basic ${credentials}`,
      'x-langfuse-public-key': LANGFUSE_PUBLIC_KEY,
    },
  })
}

/** Keeps a rejected batch from taking the API down with it.
 *
 *  Left to itself, a 401 from Langfuse — a rotated key, a typo, the wrong
 *  project — surfaces as an **uncaught exception** and kills the process.
 *  Measured, not assumed: a run against a live instance with a wrong key
 *  printed `OTLPExporterError: Unauthorized` and exited. An API that
 *  crash-loops because its optional metrics backend rejected a password is a
 *  far worse outcome than one that loses the metrics.
 *
 *  So the failure is caught, said once, and reported upwards as success. That
 *  last part is the deliberate bit: "failure" to the batch processor means
 *  retry and then throw, and nothing above here has any use for a span
 *  Langfuse will not take. */
export function guarded(inner: SpanExporter): SpanExporter {
  /** One line per minute at most. A broken key fails every batch, and a log
   *  that repeats the same sentence a hundred times an hour is one nobody
   *  reads — including the lines around it that matter. */
  const QUIET_MS = 60_000
  let lastSaid = 0

  const complain = (reason: string) => {
    const now = Date.now()
    if (lastSaid && now - lastSaid < QUIET_MS) return
    lastSaid = now
    log.error(`Không gửi được vết lên Langfuse: ${reason}. Trợ lý vẫn chạy bình thường.`)
  }

  const ok = { code: 0 as ExportResultCode }

  return {
    export(spans: ReadableSpan[], done: (result: ExportResult) => void) {
      try {
        inner.export(spans, (result) => {
          if (result.code !== 0) complain(result.error?.message ?? 'không rõ lý do')
          done(ok)
        })
      } catch (error) {
        complain(error instanceof Error ? error.message : String(error))
        done(ok)
      }
    },
    shutdown: () => inner.shutdown(),
    forceFlush: () => inner.forceFlush?.() ?? Promise.resolve(),
  }
}

export { LANGFUSE_ENABLED }
