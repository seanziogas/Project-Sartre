import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseManifest } from '@sartre/core'
import { cronMatches, MapRegistry, MemoryRunStore, PipelineEngine, Runner } from '../src/index.js'
import type { PipelineDefinition } from '../src/index.js'

const templatePath = resolve(import.meta.dirname, '../../../clients/_template/client.yaml')

function manifest(mutate: (m: ReturnType<typeof parseManifest>) => void = () => {}) {
  const m = parseManifest(readFileSync(templatePath, 'utf8'))
  m.status = 'active'
  m.modules['revops.enrichment']!.enabled = true
  m.mvd['revops.enrichment'] = { status: 'green', as_of: '2026-07-09', blocking_gaps: [] }
  mutate(m)
  return m
}

describe('cronMatches', () => {
  const at = (iso: string) => new Date(iso)
  it('matches exact minute/hour', () => {
    expect(cronMatches('0 6 * * 1', at('2026-07-06T06:00:00Z'))).toBe(true) // a Monday
    expect(cronMatches('0 6 * * 1', at('2026-07-06T06:01:00Z'))).toBe(false)
    expect(cronMatches('0 6 * * 1', at('2026-07-07T06:00:00Z'))).toBe(false) // Tuesday
  })
  it('supports steps, ranges, lists', () => {
    expect(cronMatches('*/15 * * * *', at('2026-07-09T10:45:00Z'))).toBe(true)
    expect(cronMatches('*/15 * * * *', at('2026-07-09T10:46:00Z'))).toBe(false)
    expect(cronMatches('0 9-17 * * *', at('2026-07-09T13:00:00Z'))).toBe(true)
    expect(cronMatches('0 9-17 * * *', at('2026-07-09T18:00:00Z'))).toBe(false)
    expect(cronMatches('0 0 1,15 * *', at('2026-07-15T00:00:00Z'))).toBe(true)
  })
  it('treats dow 7 as Sunday', () => {
    expect(cronMatches('0 0 * * 7', at('2026-07-05T00:00:00Z'))).toBe(true) // a Sunday
  })
  it('rejects malformed expressions', () => {
    expect(() => cronMatches('* * *', new Date())).toThrow('5 fields')
    expect(() => cronMatches('99 * * * *', new Date())).toThrow('out of bounds')
    expect(() => cronMatches('1foo * * * *', new Date())).toThrow('invalid cron value')
    expect(cronMatches('0 0 * * 6-7', at('2026-07-05T00:00:00Z'))).toBe(true)
  })
})

describe('Runner', () => {
  afterEach(() => vi.useRealTimers())
  const gatedPipeline: PipelineDefinition = {
    id: 'reactivation@0.1.0',
    moduleId: 'revops.enrichment',
    steps: [
      {
        id: 'draft',
        run: async (ctx) => {
          await ctx.gate('outbound_send', ['email'])
          return 'drafted'
        },
      },
      { id: 'send', run: async () => 'sent' },
    ],
  }

  it('resumes a run once its gate is decided (ops-surface style: store-only decision)', async () => {
    const store = new MemoryRunStore()
    const engine = new PipelineEngine(store, { runId: 'r1', now: () => new Date('2026-07-09T12:00:30Z') })
    const m = manifest()
    const parked = await engine.start(gatedPipeline, m, 'Acme')
    expect(parked.status).toBe('awaiting_approval')

    // simulate the ops surface: decision written straight to the store
    parked.gates[0]!.status = 'approved'
    parked.gates[0]!.resolvedBy = 'gtme@kiln'
    parked.gates[0]!.resolvedAt = '2026-07-09T12:01:00Z'
    await store.save(parked)

    const runner = new Runner({
      store,
      registry: new MapRegistry().register(gatedPipeline),
      manifests: async () => new Map([['Acme', m]]),
      now: () => new Date('2026-07-09T12:02:00Z'),
    })
    const report = await runner.tick()
    expect(report.resumed).toEqual(['r1'])
    expect((await store.get('r1'))!.status).toBe('completed')
    expect((await store.get('r1'))!.checkpoints.send).toBe('sent')
  })

  it('leaves runs with still-pending gates parked', async () => {
    const store = new MemoryRunStore()
    const engine = new PipelineEngine(store, { runId: 'r1' })
    const m = manifest()
    await engine.start(gatedPipeline, m, 'Acme')
    const runner = new Runner({
      store,
      registry: new MapRegistry().register(gatedPipeline),
      manifests: async () => new Map([['Acme', m]]),
    })
    const report = await runner.tick()
    expect(report.resumed).toEqual([])
    expect((await store.get('r1'))!.status).toBe('awaiting_approval')
  })

  it('fires schedules on the matching minute, once per slot, active clients only', async () => {
    const store = new MemoryRunStore()
    const scheduled: PipelineDefinition = {
      id: 'hygiene@0.1.0',
      moduleId: 'revops.enrichment',
      steps: [{ id: 'clean', run: async () => 'ok' }],
    }
    const m = manifest((x) => {
      x.modules['revops.enrichment']!.schedule = '0 6 * * *'
    })
    const paused = manifest((x) => {
      x.status = 'paused'
      x.modules['revops.enrichment']!.schedule = '0 6 * * *'
    })
    let now = new Date('2026-07-09T06:00:10Z')
    const runner = new Runner({
      store,
      registry: new MapRegistry().register(scheduled),
      manifests: async () => new Map([['Acme', m], ['Paused Co', paused]]),
      now: () => now,
    })

    const first = await runner.tick()
    expect(first.scheduled).toHaveLength(1)
    expect(first.scheduled[0]).toMatchObject({ clientId: 'Acme', pipelineId: 'hygiene@0.1.0' })

    const second = await runner.tick() // same minute — no double fire
    expect(second.scheduled).toHaveLength(0)

    now = new Date('2026-07-09T06:05:00Z') // non-matching minute
    expect((await runner.tick()).scheduled).toHaveLength(0)

    now = new Date('2026-07-10T06:00:00Z') // next day — fires again
    expect((await runner.tick()).scheduled).toHaveLength(1)
  })

  it('warns instead of crashing on unknown pipelines and bad cron', async () => {
    const store = new MemoryRunStore()
    const engine = new PipelineEngine(store, { runId: 'r1' })
    const m = manifest((x) => {
      x.modules['platform.metrics']!.schedule = 'every day at 6' // invalid
      x.mvd['platform.metrics'] = { status: 'green', as_of: '2026-07-09', blocking_gaps: [] }
    })
    const parked = await engine.start(gatedPipeline, m, 'Acme')
    parked.gates[0]!.status = 'approved'
    await store.save(parked)

    const events: unknown[] = []
    const runner = new Runner({
      store,
      registry: new MapRegistry(), // empty — nothing registered
      manifests: async () => new Map([['Acme', m]]),
      onOperationalEvent: (event) => events.push(event),
    })
    const report = await runner.tick()
    expect(report.resumed).toEqual([])
    expect(report.warnings.some((w) => w.includes('not in registry'))).toBe(true)
    expect(report.warnings.some((w) => w.includes('bad cron'))).toBe(true)
    expect(events).toMatchObject([
      { event: 'run_unresolved', fields: { runId: 'r1', clientId: 'Acme', reason: 'pipeline_missing' } },
      { event: 'schedule_invalid', fields: { clientId: 'Acme', moduleId: 'platform.metrics' } },
    ])
  })

  it('reports interval tick recovery and failure to lifecycle callbacks', async () => {
    vi.useFakeTimers()
    let fail = true
    const completed: unknown[] = []
    const errors: Error[] = []
    const warnings: string[] = []
    const runner = new Runner({
      store: new MemoryRunStore(), registry: new MapRegistry(),
      manifests: async () => {
        if (fail) throw new Error('database unavailable')
        return new Map()
      },
      onWarn: (message) => warnings.push(message),
      onTickComplete: (report) => completed.push(report),
      onTickError: (error) => errors.push(error),
    })
    runner.start(1_000)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(errors).toMatchObject([{ message: 'database unavailable' }])
    expect(warnings).toEqual(['tick failed: database unavailable'])

    fail = false
    await vi.advanceTimersByTimeAsync(1_000)
    expect(completed).toMatchObject([{ resumed: [], scheduled: [], warnings: [] }])
    runner.stop()
  })
})
