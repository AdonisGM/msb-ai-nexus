import { Logger } from '@nestjs/common'
import type { ExportResult } from '@opentelemetry/core'
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { guarded } from './tracing'

/** Tracing is optional and the API is not. Everything here is about that one
 *  sentence: a Langfuse that rejects, hangs up or is simply gone must cost the
 *  branch its metrics and nothing else.
 *
 *  The failure this was written for was real and was fatal — a wrong key made
 *  the exporter throw out of band, which Node turns into an uncaught exception
 *  and a dead process. An API that crash-loops because its optional metrics
 *  backend rejected a password is worse than one that loses the metrics. */

const SPANS = [] as unknown as ReadableSpan[]

function exporterThat(behaviour: (done: (result: ExportResult) => void) => void): SpanExporter {
  return {
    export: (_spans, done) => behaviour(done),
    shutdown: () => Promise.resolve(),
    forceFlush: () => Promise.resolve(),
  } as SpanExporter
}

/** What the batch processor does with the result: anything but success is
 *  retried and then thrown, so this is the assertion that matters. */
function resultOf(exporter: SpanExporter): Promise<ExportResult> {
  return new Promise((resolve) => exporter.export(SPANS, resolve))
}

let said: string[]

beforeEach(() => {
  said = []
  vi.spyOn(Logger.prototype, 'error').mockImplementation((message: unknown) => {
    said.push(String(message))
  })
})

afterEach(() => vi.restoreAllMocks())

describe('the guard around the span exporter', () => {
  it('passes a successful export through untouched', async () => {
    const exporter = guarded(exporterThat((done) => done({ code: 0 })))

    expect((await resultOf(exporter)).code).toBe(0)
    expect(said).toEqual([])
  })

  it('reports a rejected batch as success, so nothing upstream throws', async () => {
    const exporter = guarded(
      exporterThat((done) => done({ code: 1, error: new Error('Unauthorized') })),
    )

    expect((await resultOf(exporter)).code).toBe(0)
    expect(said).toHaveLength(1)
    expect(said[0]).toContain('Unauthorized')
  })

  /** The shape that actually killed the process: the inner exporter throws
   *  rather than calling back. */
  it('survives an exporter that throws instead of calling back', async () => {
    const exporter = guarded(
      exporterThat(() => {
        throw new Error('socket hang up')
      }),
    )

    expect((await resultOf(exporter)).code).toBe(0)
    expect(said[0]).toContain('socket hang up')
  })

  it('says something even when the failure carries no error', async () => {
    const exporter = guarded(exporterThat((done) => done({ code: 1 })))

    await resultOf(exporter)
    expect(said[0]).toContain('không rõ lý do')
  })

  /** A broken key fails every batch. A log that repeats the same sentence a
   *  hundred times an hour is one nobody reads, including the lines around it
   *  that matter. */
  it('says it once, not once per batch', async () => {
    const exporter = guarded(
      exporterThat((done) => done({ code: 1, error: new Error('Unauthorized') })),
    )

    for (let i = 0; i < 20; i++) await resultOf(exporter)
    expect(said).toHaveLength(1)
  })

  it('says it again after the quiet minute has passed', async () => {
    vi.useFakeTimers()
    try {
      const exporter = guarded(
        exporterThat((done) => done({ code: 1, error: new Error('Unauthorized') })),
      )

      await resultOf(exporter)
      vi.advanceTimersByTime(61_000)
      await resultOf(exporter)

      expect(said).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('hands shutdown and flush to the exporter it wraps', async () => {
    const shutdown = vi.fn(() => Promise.resolve())
    const forceFlush = vi.fn(() => Promise.resolve())
    const exporter = guarded({
      export: (_spans, done) => done({ code: 0 }),
      shutdown,
      forceFlush,
    } as SpanExporter)

    await exporter.shutdown()
    await exporter.forceFlush?.()

    expect(shutdown).toHaveBeenCalledOnce()
    expect(forceFlush).toHaveBeenCalledOnce()
  })

  /** Not every `SpanExporter` implements `forceFlush` — it is optional in the
   *  interface, and calling through to `undefined` would throw inside a
   *  shutdown path that exists to lose nothing. */
  it('tolerates an exporter with no forceFlush', async () => {
    const exporter = guarded({
      export: (_spans, done) => done({ code: 0 }),
      shutdown: () => Promise.resolve(),
    } as SpanExporter)

    await expect(exporter.forceFlush?.()).resolves.toBeUndefined()
  })
})
