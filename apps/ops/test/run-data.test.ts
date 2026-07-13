import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { parseManifest } from '@sartre/core'
import { migrate, PostgresFeedbackLog, PostgresRunStore } from '@sartre/db'
import type { Queryable } from '@sartre/db'
import { MapRegistry, PipelineEngine, Runner } from '@sartre/pipelines'
import type { PipelineDefinition } from '@sartre/pipelines'
import { OpsRunData } from '../src/lib/run-data.js'

const templatePath = resolve(import.meta.dirname, '../../../clients/_template/client.yaml')

let pglite: PGlite
let db: Queryable

beforeAll(async () => {
  pglite = new PGlite()
  db = {
    query: async (sql, params) => {
      const result = await pglite.query(sql, params as never[])
      return { rows: result.rows as unknown[] }
    },
  }
  const raw = pglite as unknown as { exec(sql: string): Promise<unknown> }
  const migrateDb: Queryable = {
    query: async (sql, params) =>
      params && params.length > 0
        ? db.query(sql, params)
        : ((await raw.exec(sql)), { rows: [] }),
  }
  await migrate(migrateDb)
})

afterAll(async () => {
  await pglite.close()
})

function manifest() {
  const value = parseManifest(readFileSync(templatePath, 'utf8'))
  value.status = 'active'
  value.modules['revops.enrichment']!.enabled = true
  delete value.modules['revops.enrichment']!.schedule
  value.mvd['revops.enrichment'] = {
    status: 'green',
    as_of: '2026-07-13',
    blocking_gaps: [],
  }
  return value
}

describe('OpsRunData with Postgres and the runner', () => {
  it('records a tenant-scoped decision and leaves resume to the runner', async () => {
    const store = new PostgresRunStore(db)
    const feedback = new PostgresFeedbackLog(db)
    const pipeline: PipelineDefinition = {
      id: 'ops-runner-boundary@1',
      moduleId: 'revops.enrichment',
      steps: [
        {
          id: 'draft',
          run: async (ctx) => {
            await ctx.gate('outbound_send', { subject: 'Review me' })
            return 'approved draft'
          },
        },
        { id: 'send', run: async () => 'sent' },
      ],
    }
    const clientManifest = manifest()
    const parked = await new PipelineEngine(store, { runId: 'ops-pg-r1' }).start(
      pipeline,
      clientManifest,
      'Acme',
    )
    expect(parked.status).toBe('awaiting_approval')

    const ops = new OpsRunData(
      store,
      feedback,
      () => new Date('2026-07-13T12:00:00Z'),
      () => '00000000-0000-4000-8000-000000000001',
    )
    expect(await ops.getRun('OtherClient', parked.runId)).toBeNull()
    expect(await ops.listPendingGates('OtherClient')).toHaveLength(0)
    expect(await ops.listPendingGates('Acme')).toMatchObject([
      { gateId: 'draft:outbound_send', outputClass: 'outbound_send' },
    ])

    await ops.decideGate(
      'Acme',
      parked.runId,
      'draft:outbound_send',
      'approved',
      'gtme@kiln',
      'Copy checked',
    )

    const decided = await store.get(parked.runId)
    expect(decided).toMatchObject({
      status: 'awaiting_approval',
      gates: [{ status: 'approved', resolvedBy: 'gtme@kiln' }],
      feedbackEvents: [{ action: 'approve', reason: 'Copy checked' }],
    })
    expect(await feedback.list('Acme')).toMatchObject([
      { action: 'approve', reason: 'Copy checked' },
    ])
    expect(await feedback.list('OtherClient')).toHaveLength(0)

    const runner = new Runner({
      store,
      registry: new MapRegistry().register(pipeline),
      manifests: async () => new Map([['Acme', clientManifest]]),
      now: () => new Date('2026-07-13T12:01:00Z'),
    })
    const report = await runner.tick()
    expect(report.resumed).toEqual([parked.runId])
    expect(await store.get(parked.runId)).toMatchObject({
      status: 'completed',
      checkpoints: { draft: 'approved draft', send: 'sent' },
    })
  })
})
