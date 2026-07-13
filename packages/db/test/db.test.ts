import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { parseManifest } from '@sartre/core'
import { EnrichmentCache } from '@sartre/connectors'
import { PipelineEngine, Runner, MapRegistry } from '@sartre/pipelines'
import type { PipelineDefinition } from '@sartre/pipelines'
import { migrate, PostgresCacheStore, PostgresFeedbackLog, PostgresRunStore } from '../src/index.js'
import type { Queryable } from '../src/index.js'

const templatePath = resolve(import.meta.dirname, '../../../clients/_template/client.yaml')

let db: Queryable

beforeAll(async () => {
  const pglite = new PGlite()
  db = {
    query: async (sql, params) => {
      const res = await pglite.query(sql, params as never[])
      return { rows: res.rows as unknown[] }
    },
  }
  // PGlite runs one statement per query call for parameterized queries, but
  // multi-statement migration text works via exec
  const raw = pglite as unknown as { exec(sql: string): Promise<unknown> }
  const migrateDb: Queryable = {
    query: async (sql, params) =>
      params && params.length > 0
        ? db.query(sql, params)
        : ((await raw.exec(sql)), { rows: [] }),
  }
  await migrate(migrateDb)
})

function manifest() {
  const m = parseManifest(readFileSync(templatePath, 'utf8'))
  m.status = 'active'
  m.modules['revops.enrichment']!.enabled = true
  m.mvd['revops.enrichment'] = { status: 'green', as_of: '2026-07-09', blocking_gaps: [] }
  return m
}

describe('PostgresRunStore (against PGlite)', () => {
  it('round-trips runs through the real engine, upserts on save', async () => {
    const store = new PostgresRunStore(db)
    const engine = new PipelineEngine(store, { runId: 'pg-r1' })
    const run = await engine.start(
      { id: 'p@1', moduleId: 'revops.enrichment', steps: [{ id: 'a', run: async () => 42 }] },
      manifest(),
      'Acme',
    )
    expect(run.status).toBe('completed')
    const loaded = await store.get('pg-r1')
    expect(loaded).toMatchObject({ runId: 'pg-r1', status: 'completed', checkpoints: { a: 42 } })
    expect((await store.list('Acme')).map((r) => r.runId)).toContain('pg-r1')
    expect((await store.list('OtherClient'))).toHaveLength(0) // tenancy scoping
  })

  it('supports the runner end-to-end: park, decide, resume — all in Postgres', async () => {
    const store = new PostgresRunStore(db)
    const gated: PipelineDefinition = {
      id: 'gated@1',
      moduleId: 'revops.enrichment',
      steps: [
        { id: 'draft', run: async (ctx) => { await ctx.gate('outbound_send', 'copy'); return 'ok' } },
        { id: 'send', run: async () => 'sent' },
      ],
    }
    const m = manifest()
    const engine = new PipelineEngine(store, { runId: 'pg-r2' })
    const parked = await engine.start(gated, m, 'Acme')
    expect(parked.status).toBe('awaiting_approval')

    parked.gates[0]!.status = 'approved'
    parked.gates[0]!.resolvedBy = 'gtme@kiln'
    await store.save(parked)

    const runner = new Runner({
      store,
      registry: new MapRegistry().register(gated),
      manifests: async () => new Map([['Acme', m]]),
    })
    const report = await runner.tick()
    expect(report.resumed).toContain('pg-r2')
    expect((await store.get('pg-r2'))!.status).toBe('completed')
  })

  it('atomically rejects a second decision on the same Postgres gate', async () => {
    const store = new PostgresRunStore(db)
    const gated: PipelineDefinition = {
      id: 'decision-cas@1',
      moduleId: 'revops.enrichment',
      steps: [{ id: 'draft', run: async (ctx) => { await ctx.gate('outbound_send', 'copy'); return 'ok' } }],
    }
    await new PipelineEngine(store, { runId: 'pg-r3' }).start(gated, manifest(), 'Acme')
    await store.decideGate({
      runId: 'pg-r3',
      gateId: 'draft:outbound_send',
      decision: 'approved',
      actor: 'first',
      resolvedAt: '2026-07-10T12:00:00Z',
    })
    await expect(store.decideGate({
      runId: 'pg-r3',
      gateId: 'draft:outbound_send',
      decision: 'rejected',
      actor: 'second',
      resolvedAt: '2026-07-10T12:00:01Z',
    })).rejects.toThrow('already approved')
  })
})

describe('PostgresCacheStore (against PGlite)', () => {
  it('backs the EnrichmentCache with correct merge semantics', async () => {
    const cache = new EnrichmentCache(new PostgresCacheStore(db), () => new Date('2026-07-09T00:00:00Z'))
    await cache.record('acme.com', {
      industry: { value: 'SaaS', provenance: { source: 'enrichment', origin: 'clay', retrievedAt: '2026-07-01T00:00:00Z', confidence: 'high' } },
    })
    const hit = await cache.lookup('acme.com')
    expect(hit.hit).toBe(true)
    expect(hit.fresh.industry?.value).toBe('SaaS')
    // boundary allowlist still enforced through the pg store
    const rejected = await cache.record('acme.com', {
      icp_grade: { value: 'A', provenance: { source: 'inference', origin: 'grader', retrievedAt: '2026-07-01T00:00:00Z', confidence: 'high' } },
    })
    expect(rejected.rejected).toEqual(['icp_grade'])
  })
})

describe('PostgresFeedbackLog (against PGlite)', () => {
  it('appends idempotently and lists client-scoped, newest first', async () => {
    const log = new PostgresFeedbackLog(db)
    const event = {
      kind: 'human_action' as const,
      id: 'evt-1',
      clientId: 'Acme',
      occurredAt: '2026-07-09T12:00:00Z',
      actor: 'gtme@kiln',
      action: 'approve' as const,
      machine: { skillId: 's@1', runId: 'pg-r2', itemRef: 'g1', output: 'copy' },
      surface: 'review_queue' as const,
    }
    await log.append(event)
    await log.append(event) // duplicate id — no-op
    const listed = await log.list('Acme')
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ id: 'evt-1', action: 'approve' })
    expect(await log.list('OtherClient')).toHaveLength(0)
  })
})
