import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { parseManifest } from '@sartre/core'
import type { Account } from '@sartre/core'
import { EnrichmentCache } from '@sartre/connectors'
import { CanonicalIngestionCoordinator, mapSourceRow } from '@sartre/data'
import { PipelineEngine, Runner, MapRegistry } from '@sartre/pipelines'
import type { PipelineDefinition } from '@sartre/pipelines'
import {
  migrate,
  PostgresCacheStore,
  PostgresCanonicalStore,
  PostgresFeedbackLog,
  PostgresRunStore,
  PostgresRuntimeArtifactStore,
  PostgresStagingStore,
  PostgresToolConnectionStore,
  PostgresToolConnectionEventStore,
  PostgresConnectorSnapshotStore,
  PostgresEffectLedger,
  PostgresScheduleClaimStore,
} from '../src/index.js'
import type { Queryable, TenantQueryable } from '../src/index.js'

const templatePath = resolve(import.meta.dirname, '../../../clients/_template/client.yaml')

let db: TenantQueryable

beforeAll(async () => {
  const pglite = new PGlite()
  let scopedQueue = Promise.resolve()
  const scoped = <T>(setting: string, value: string, run: () => Promise<T>): Promise<T> => {
    const result = scopedQueue.then(async () => {
      await pglite.query('BEGIN')
      try {
        await pglite.query(`SELECT set_config('${setting}', $1, true)`, [value])
        const output = await run()
        await pglite.query('COMMIT')
        return output
      } catch (error) {
        await pglite.query('ROLLBACK')
        throw error
      }
    })
    scopedQueue = result.then(() => undefined, () => undefined)
    return result
  }
  db = {
    query: async (sql, params) => {
      const res = await pglite.query(sql, params as never[])
      return { rows: res.rows as unknown[] }
    },
    queryTenant: (clientId, sql, params) => scoped('sartre.client_id', clientId, async () => {
      const res = await pglite.query(sql, params as never[]); return { rows: res.rows as unknown[] }
    }),
    querySystem: (sql, params) => scoped('sartre.system_access', 'on', async () => {
      const res = await pglite.query(sql, params as never[]); return { rows: res.rows as unknown[] }
    }),
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
  await migrate(migrateDb) // migrations remain safe on an existing schema
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

describe('PostgresRuntimeArtifactStore (against PGlite)', () => {
  it('keeps machine-owned MVD and reports tenant scoped', async () => {
    const store = new PostgresRuntimeArtifactStore(db)
    await store.put('ArtifactAcme', 'mvd', { 'revops.tam': { status: 'green' } })
    expect(await store.get('ArtifactAcme', 'mvd')).toEqual({ 'revops.tam': { status: 'green' } })
    expect(await store.get('OtherClient', 'mvd')).toBeNull()
  })

  it('enforces row-level security when a query omits tenant context', async () => {
    await db.query('RESET sartre.client_id')
    await db.query('RESET sartre.system_access')
    await db.query('CREATE ROLE sartre_rls_test')
    await db.query('GRANT SELECT, INSERT ON runtime_artifacts TO sartre_rls_test')
    await db.query('SET ROLE sartre_rls_test')
    try {
      const raw = await db.query('SELECT value FROM runtime_artifacts')
      expect(raw.rows).toHaveLength(0)
      await expect(db.query("INSERT INTO runtime_artifacts (client_id, artifact_key, value, updated_at) VALUES ('Other', 'x', '{}', now())"))
        .rejects.toThrow()
    } finally {
      await db.query('RESET ROLE')
    }
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

describe('PostgresToolConnectionStore (against PGlite)', () => {
  it('keeps encrypted credentials tenant-scoped and out of list responses', async () => {
    const store = new PostgresToolConnectionStore(db)
    await store.put({
      connectionId: '9a6c8cbe-ef44-4ceb-955a-9b136de1877e',
      clientId: 'Acme',
      provider: 'salesforce',
      authKind: 'oauth',
      label: 'Production Salesforce',
      status: 'active',
      encryptedCredentials: 'v1.test-only-envelope',
      metadata: { instanceUrl: 'https://acme.example' },
      createdAt: '2026-07-13T12:00:00Z',
      updatedAt: '2026-07-13T12:00:00Z',
    })

    const listed = await store.list('Acme')
    expect(listed).toHaveLength(1)
    expect(listed[0]).not.toHaveProperty('encryptedCredentials')
    expect(await store.list('OtherClient')).toHaveLength(0)
    expect(await store.get('OtherClient', listed[0]!.connectionId)).toBeNull()
    expect((await store.get('Acme', listed[0]!.connectionId))?.encryptedCredentials).toBe('v1.test-only-envelope')

    expect(await store.revoke('Acme', listed[0]!.connectionId, '2026-07-13T13:00:00Z')).toBe(true)
    expect(await store.list('Acme')).toHaveLength(0)
    const revoked = await store.get('Acme', listed[0]!.connectionId)
    expect(revoked).toMatchObject({ status: 'revoked', encryptedCredentials: '' })
  })

  it('records an append-only tenant-scoped connection audit trail', async () => {
    const events = new PostgresToolConnectionEventStore(db)
    await events.append({
      eventId: '2af84084-109d-43fe-b9a0-406375a731f2',
      connectionId: '9a6c8cbe-ef44-4ceb-955a-9b136de1877e',
      clientId: 'Acme', kind: 'tested', actor: 'owner@acme.example',
      detail: 'Salesforce API reachable', occurredAt: '2026-07-13T14:00:00Z',
    })
    expect(await events.list('Acme')).toEqual([expect.objectContaining({ kind: 'tested', actor: 'owner@acme.example' })])
    expect(await events.list('OtherClient')).toHaveLength(0)
  })
})

describe('PostgresConnectorSnapshotStore (against PGlite)', () => {
  it('persists snapshot proof within one tenant only', async () => {
    const acme = new PostgresConnectorSnapshotStore(db, 'Acme')
    const ref = await acme.capture('salesforce', [{ object: 'account', externalId: '001', fields: { Kiln_Score__c: 90 } }], [{ Kiln_Score__c: 10 }])
    expect(await acme.exists('salesforce', ref)).toBe(true)
    expect(await new PostgresConnectorSnapshotStore(db, 'OtherClient').exists('salesforce', ref)).toBe(false)
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

describe('durable execution claims (against PGlite)', () => {
  it('allows one schedule claim across replicas', async () => {
    const first = new PostgresScheduleClaimStore(db)
    const second = new PostgresScheduleClaimStore(db)
    expect(await first.claim('ClaimAcme', 'platform.metrics', '2026-07-14T12:00')).toBe(true)
    expect(await second.claim('ClaimAcme', 'platform.metrics', '2026-07-14T12:00')).toBe(false)
    expect(await second.claim('OtherClaim', 'platform.metrics', '2026-07-14T12:00')).toBe(true)
  })

  it('returns completed effects and refuses ambiguous or changed replays', async () => {
    const ledger = new PostgresEffectLedger(db)
    let calls = 0
    expect(await ledger.execute('EffectAcme', 'run:gate', { to: 'a@example.com' }, async () => ({ id: `m${++calls}` }))).toEqual({ id: 'm1' })
    expect(await ledger.execute('EffectAcme', 'run:gate', { to: 'a@example.com' }, async () => ({ id: `m${++calls}` }))).toEqual({ id: 'm1' })
    expect(calls).toBe(1)
    await expect(ledger.execute('EffectAcme', 'run:gate', { to: 'b@example.com' }, async () => ({}))).rejects.toThrow('different payload')
    await expect(ledger.execute('EffectAcme', 'ambiguous', {}, async () => { throw new Error('response lost') })).rejects.toThrow('response lost')
    await expect(ledger.execute('EffectAcme', 'ambiguous', {}, async () => ({}))).rejects.toThrow('pending reconciliation')
  })
})

describe('PostgresStagingStore (against PGlite)', () => {
  it('stores raw batches idempotently and tenant-scoped', async () => {
    const store = new PostgresStagingStore(db)
    const batch = {
      connectorId: 'salesforce',
      object: 'account' as const,
      extractedAt: '2026-07-13T12:00:00Z',
      cursor: 'next-1',
      rows: [{ Id: '001', Name: 'Acme' }],
    }
    const first = await store.append('Acme', batch)
    const retry = await store.append('Acme', batch)
    expect(retry.batchId).toBe(first.batchId)
    expect(await store.list('Acme', { connectorId: 'salesforce', object: 'account' })).toHaveLength(1)
    expect(await store.get('OtherClient', first.batchId)).toBeNull()

    await expect(store.append('Acme', { ...batch, extractedAt: 'not-a-date' })).rejects.toThrow()
    await store.append('Acme', batch, 'fixed-key')
    await expect(store.append('Acme', { ...batch, rows: [{ Id: '002' }] }, 'fixed-key')).rejects.toThrow('different content')
    await store.append('Acme', {
      ...batch,
      object: 'lead',
      rows: [{ Id: '00Q-1', Email: 'buyer@acme.example' }],
    })
    expect(await store.list('Acme', { object: 'lead' })).toHaveLength(1)
    await store.append('Acme', {
      ...batch,
      connectorId: 'clearbit',
      object: 'signal',
      rows: [{ id: 'sig-1', domain: 'acme.example' }],
    })
    expect(await store.list('Acme', { object: 'signal' })).toHaveLength(1)
  })
})

describe('PostgresCanonicalStore (against PGlite)', () => {
  it('upserts validated golden records and isolates external-id lookup by client', async () => {
    const store = new PostgresCanonicalStore(db)
    const account = accountRecord('Acme', '00000000-0000-4000-8000-000000000101', '001-acme')
    await store.put('Acme', 'account', account)

    expect(await store.get('OtherClient', 'account', account.id)).toBeNull()
    expect(await store.findByExternalId('OtherClient', 'account', 'salesforce', '001-acme')).toBeNull()
    expect(await store.findByExternalId('Acme', 'account', 'salesforce', '001-acme')).toMatchObject({
      id: account.id,
      name: { value: 'Acme' },
    })

    const updated = { ...account, flags: ['needs_review' as const], updatedAt: '2026-07-13T13:00:00Z' }
    await store.put('Acme', 'account', updated)
    expect(await store.list('Acme', 'account')).toMatchObject([{ flags: ['needs_review'] }])
    await expect(store.put('OtherClient', 'account', account)).rejects.toThrow('does not match')

    const collision = accountRecord('Acme', '00000000-0000-4000-8000-000000000102', '001-acme')
    await expect(store.put('Acme', 'account', collision)).rejects.toThrow('already belongs')
  })

  it('persists reviewed canonical signals with tenant and external-id safeguards', async () => {
    const store = new PostgresCanonicalStore(db)
    const signal = {
      id: '00000000-0000-4000-8000-000000000201',
      clientId: 'SignalClient',
      externalIds: { clearbit: 'sig-1' },
      createdAt: '2026-07-13T12:00:00Z',
      updatedAt: '2026-07-13T12:00:00Z',
      flags: [],
      accountId: null,
      contactId: null,
      kind: 'pricing-visit',
      observedAt: '2026-07-13T11:00:00Z',
      detail: 'Visited pricing',
      provenance: { source: 'web' as const, origin: 'clearbit', retrievedAt: '2026-07-13T12:00:00Z', confidence: 'high' as const, runId: 'deanon-r1' },
    }
    expect(await store.putSignals('SignalClient', [signal])).toMatchObject([{ externalIds: { clearbit: 'sig-1' } }])
    expect(await store.list('SignalClient', 'signal')).toMatchObject([{ kind: 'pricing-visit' }])
    await expect(store.putSignals('OtherClient', [signal])).rejects.toThrow('does not match')
  })

  it('persists promoted candidates and returns canonical audit views', async () => {
    const store = new PostgresCanonicalStore(db)
    const candidate = (externalId: string, name: string) => mapSourceRow(
      { Id: externalId, Name: name, Website: 'durable.example', OwnerId: 'rep-1', LastModified: '2026-06-01T00:00:00Z' },
      {
        object: 'account',
        externalIdField: 'Id',
        fields: [
          { source: 'Name', target: 'name', transform: 'trim' },
          { source: 'Website', target: 'domain', transform: 'domain' },
          { source: 'OwnerId', target: 'ownerRef', transform: 'trim' },
          { source: 'LastModified', target: 'sourceUpdatedAt', transform: 'datetime' },
        ],
      },
      { clientId: 'DurableClient', connectorId: 'hubspot', extractedAt: '2026-07-13T12:00:00Z' },
    )
    const ids = [
      '00000000-0000-4000-8000-000000000301',
      '00000000-0000-4000-8000-000000000302',
    ]
    const promoted = await store.promoteAccounts(
      'DurableClient',
      [candidate('company-1', 'Durable One'), candidate('company-2', 'Durable Two')],
      { now: () => new Date('2026-07-13T13:00:00Z'), createId: () => ids.shift()! },
    )
    const audit = await store.auditRows('DurableClient')

    expect(promoted.records).toHaveLength(2)
    expect(promoted.records.every((record) => record.flags.includes('duplicate'))).toBe(true)
    expect(audit.accounts).toHaveLength(2)
    expect(audit.accounts[0]).toMatchObject({ domain: 'durable.example', ownerRef: 'rep-1' })
    expect(audit.contacts).toEqual([])
    expect(await store.duplicateReviewGroups('DurableClient')).toMatchObject([{
      recordType: 'account',
      confidence: 'high',
      members: expect.arrayContaining([
        expect.objectContaining({ externalIds: { hubspot: 'company-1' } }),
        expect.objectContaining({ externalIds: { hubspot: 'company-2' } }),
      ]),
    }])
    expect(await store.duplicateReviewGroups('OtherClient')).toEqual([])
  })

  it('coordinates stage, promotion, and tenant-scoped relationship resolution', async () => {
    const staging = new PostgresStagingStore(db)
    const canonical = new PostgresCanonicalStore(db)
    const coordinator = new CanonicalIngestionCoordinator(staging, canonical)
    const extractedAt = '2026-07-13T12:00:00Z'
    await canonical.put(
      'Acme',
      'account',
      accountRecord('Acme', '00000000-0000-4000-8000-000000000499', 'cross-tenant-only'),
    )
    const accountBatch = {
      connectorId: 'salesforce',
      object: 'account' as const,
      extractedAt,
      cursor: null,
      rows: [{ Id: 'ref-account-1', Name: 'Reference Co', Website: 'reference.example', OwnerId: 'rep-1', LastModified: extractedAt }],
    }
    const contactBatch = {
      connectorId: 'salesforce',
      object: 'contact' as const,
      extractedAt,
      cursor: null,
      rows: [
        { Id: 'ref-contact-1', FirstName: 'Jane', LastName: 'Doe', Email: 'jane@reference.example', AccountId: 'ref-account-1', OwnerId: 'rep-1', LastModified: extractedAt },
        { Id: 'ref-contact-2', FirstName: 'Tenant', LastName: 'Boundary', Email: 'boundary@reference.example', AccountId: 'cross-tenant-only', OwnerId: 'rep-1', LastModified: extractedAt },
      ],
    }
    const opportunityBatch = {
      connectorId: 'salesforce',
      object: 'opportunity' as const,
      extractedAt,
      cursor: null,
      rows: [{
        Id: 'ref-opportunity-1',
        AccountId: 'ref-account-1',
        Name: 'Reference renewal',
        StageName: 'Closed Lost',
        Amount: 250000,
        CloseDate: '2026-06-30T00:00:00Z',
        IsClosed: true,
        IsWon: false,
        LossReason: 'Timing',
      }],
    }
    const activityBatch = {
      connectorId: 'salesforce',
      object: 'activity' as const,
      extractedAt,
      cursor: null,
      rows: [{
        Id: 'ref-activity-1',
        AccountId: 'ref-account-1',
        ContactId: 'ref-contact-1',
        Type: 'meeting',
        ActivityDate: '2026-07-12T10:00:00Z',
        Direction: 'inbound',
        Summary: 'Revisit next quarter',
      }],
    }
    const accountMapping = {
      object: 'account',
      externalIdField: 'Id',
      fields: [
        { source: 'Name', target: 'name', transform: 'trim' },
        { source: 'Website', target: 'domain', transform: 'domain' },
        { source: 'OwnerId', target: 'ownerRef', transform: 'trim' },
        { source: 'LastModified', target: 'sourceUpdatedAt', transform: 'datetime' },
      ],
    }
    const contactMapping = {
      object: 'contact',
      externalIdField: 'Id',
      fields: [
        { source: 'FirstName', target: 'firstName', transform: 'trim' },
        { source: 'LastName', target: 'lastName', transform: 'trim' },
        { source: 'Email', target: 'email', transform: 'email' },
        { source: 'OwnerId', target: 'ownerRef', transform: 'trim' },
        { source: 'LastModified', target: 'sourceUpdatedAt', transform: 'datetime' },
      ],
      references: [{ source: 'AccountId', target: 'accountId', recordType: 'account', required: true }],
    }
    const opportunityMapping = {
      object: 'opportunity',
      externalIdField: 'Id',
      fields: [
        { source: 'Name', target: 'name', transform: 'trim' },
        { source: 'StageName', target: 'stage', transform: 'trim' },
        { source: 'Amount', target: 'amountUsd', transform: 'number' },
        { source: 'CloseDate', target: 'closeDate', transform: 'datetime' },
        { source: 'IsClosed', target: 'isClosed', transform: 'boolean' },
        { source: 'IsWon', target: 'isWon', transform: 'boolean' },
        { source: 'LossReason', target: 'lossReason', transform: 'trim' },
      ],
      references: [{ source: 'AccountId', target: 'accountId', recordType: 'account', required: true }],
    }
    const activityMapping = {
      object: 'activity',
      externalIdField: 'Id',
      fields: [
        { source: 'Type', target: 'type', transform: 'trim', required: true },
        { source: 'ActivityDate', target: 'occurredAt', transform: 'datetime', required: true },
        { source: 'Direction', target: 'direction', transform: 'trim' },
        { source: 'Summary', target: 'summary', transform: 'trim' },
      ],
      references: [
        { source: 'AccountId', target: 'accountId', recordType: 'account' },
        { source: 'ContactId', target: 'contactId', recordType: 'contact' },
      ],
    }
    const ids = [
      '00000000-0000-4000-8000-000000000401',
      '00000000-0000-4000-8000-000000000402',
      '00000000-0000-4000-8000-000000000403',
      '00000000-0000-4000-8000-000000000404',
      '00000000-0000-4000-8000-000000000405',
    ]
    const result = await coordinator.refresh(
      'ReferenceClient',
      {
        accountBatch,
        contactBatch,
        opportunityBatch,
        activityBatch,
        accountMapping,
        contactMapping,
        opportunityMapping,
        activityMapping,
        runId: 'ingestion-run-1',
      },
      { now: () => new Date('2026-07-13T13:00:00Z'), createId: () => ids.shift()! },
    )

    expect(result.audit.accounts).toHaveLength(1)
    expect(result.audit.contacts).toHaveLength(2)
    expect(result.audit.contacts.find((contact) => contact.id.endsWith('402'))?.accountRef)
      .toBe('00000000-0000-4000-8000-000000000401')
    expect(result.audit.contacts.find((contact) => contact.id.endsWith('403'))?.accountRef).toBeNull()
    expect(result.contacts.problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ problem: expect.stringContaining('unresolved account reference salesforce:cross-tenant-only') }),
    ]))
    expect(result.opportunities?.records[0]).toMatchObject({
      id: '00000000-0000-4000-8000-000000000404',
      accountId: '00000000-0000-4000-8000-000000000401',
      isClosed: true,
      isWon: false,
    })
    expect(result.activities?.records[0]).toMatchObject({
      id: '00000000-0000-4000-8000-000000000405',
      accountId: '00000000-0000-4000-8000-000000000401',
      contactId: '00000000-0000-4000-8000-000000000402',
      type: 'meeting',
    })
    expect(await canonical.closedLostRows('ReferenceClient')).toMatchObject([{
      id: '00000000-0000-4000-8000-000000000404',
      fields: { account_name: 'Reference Co', opportunity_loss_reason: 'Timing' },
    }])
    expect(await canonical.closedLostRows('Acme')).toHaveLength(0)
    expect(await canonical.briefContexts('ReferenceClient')).toMatchObject([{
      accountId: '00000000-0000-4000-8000-000000000401',
      accountName: 'Reference Co',
      evidence: expect.arrayContaining([
        expect.objectContaining({ id: 'opportunity:00000000-0000-4000-8000-000000000404' }),
        expect.objectContaining({ id: 'activity:00000000-0000-4000-8000-000000000405' }),
      ]),
    }])
    expect((await canonical.briefContexts('Acme')).flatMap((context) => context.evidence))
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'activity:00000000-0000-4000-8000-000000000405' })]))
    expect(await staging.list('ReferenceClient')).toHaveLength(4)

    // Exact retry reuses staging batches and canonical external identities.
    await coordinator.refresh('ReferenceClient', {
      accountBatch,
      contactBatch,
      opportunityBatch,
      activityBatch,
      accountMapping,
      contactMapping,
      opportunityMapping,
      activityMapping,
    })
    expect(await staging.list('ReferenceClient')).toHaveLength(4)
    expect(await canonical.listAll('ReferenceClient', 'contact')).toHaveLength(2)
    expect(await canonical.listAll('ReferenceClient', 'opportunity')).toHaveLength(1)
    expect(await canonical.listAll('ReferenceClient', 'activity')).toHaveLength(1)

    await expect(coordinator.refresh('ReferenceClient', {
      accountBatch,
      contactBatch,
      opportunityBatch,
      accountMapping,
      contactMapping,
    })).rejects.toThrow('opportunity batch and mapping must be provided together')
    expect(await staging.list('ReferenceClient')).toHaveLength(4)
  })
})

function accountRecord(clientId: string, id: string, externalId: string): Account {
  const provenance = {
    source: 'crm' as const,
    origin: 'salesforce',
    retrievedAt: '2026-07-13T12:00:00Z',
    confidence: 'high' as const,
  }
  const field = <T>(value: T | null) => ({ value, provenance })
  return {
    id,
    clientId,
    externalIds: { salesforce: externalId },
    createdAt: '2026-07-13T12:00:00Z',
    updatedAt: '2026-07-13T12:00:00Z',
    flags: [],
    name: field('Acme'),
    domain: field('acme.com'),
    industry: field('Software'),
    employeeCount: field(500),
    revenueUsd: field(125000000),
    revenueTier: field('$100M+'),
    country: field('US'),
    state: field('CA'),
    linkedinUrl: field('linkedin.com/company/acme'),
    parentCompanyName: field(null),
    parentCompanyRevenueUsd: field(null),
    accountType: field('prospect'),
    ownerRef: field('rep-1'),
    sourceUpdatedAt: field('2026-07-01T00:00:00Z'),
    icpScore: field(null),
    icpGrade: field(null),
  }
}
