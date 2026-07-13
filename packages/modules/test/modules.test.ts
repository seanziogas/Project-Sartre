import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseManifest } from '@sartre/core'
import type { MvdStatus } from '@sartre/core'
import { EnrichmentCache, MemoryCacheStore } from '@sartre/connectors'
import { runDataAudit } from '@sartre/data'
import type { DataHealthReport } from '@sartre/data'
import { MemoryRunStore, PipelineEngine } from '@sartre/pipelines'
import type { LlmClient } from '@sartre/skills'
import {
  buildEnrichmentRefreshPipeline,
  buildInboundRoutingPipeline,
  buildReactivationPipeline,
  buildRemediationPipeline,
  buildCopilotBriefsPipeline,
} from '../src/index.js'

const templatePath = resolve(import.meta.dirname, '../../../clients/_template/client.yaml')
const NOW = () => new Date('2026-07-09T12:00:00Z')

function manifest(moduleId: string, mutate: (m: ReturnType<typeof parseManifest>) => void = () => {}) {
  const m = parseManifest(readFileSync(templatePath, 'utf8'))
  m.status = 'active'
  m.modules[moduleId] = { enabled: true, always_on: false, thresholds: {} }
  m.mvd[moduleId] = { status: 'green', as_of: '2026-07-09', blocking_gaps: [] }
  mutate(m)
  return m
}

describe('enrichment-refresh pipeline (Day-1 Audit + always-on hygiene)', () => {
  it('audits, refreshes MVD, and alerts on drift end-to-end', async () => {
    const saved: Record<string, unknown> = {}
    const notifications: string[] = []
    const previousReport = {
      // fabricated healthy previous report — only fields drift reads
      score: 95,
      counts: { accounts: 2, contacts: 1 },
      identifierCoverage: { accountDomain: 1, accountLinkedin: 0, contactEmail: 1, contactLinkedin: 0, invalidAccountDomains: 0, invalidContactEmails: 0 },
      duplicates: { accountGroups: 0, accountRecordsInGroups: 0, contactGroups: 0, contactRecordsInGroups: 0, accountDensity: 0, contactDensity: 0 },
      staleness: { staleDays: 365, staleAccounts: 0, staleContacts: 0 },
      orphanContacts: 0,
      ownership: { accountsUnowned: 0, contactsUnowned: 0 },
      generatedAt: '2026-07-01T00:00:00Z',
      fillRates: [],
      scoreBreakdown: [],
    } as unknown as DataHealthReport
    let storedReport: DataHealthReport | null = previousReport

    const pipeline = buildEnrichmentRefreshPipeline({
      pullAccounts: async () => [
        { id: '1', name: 'A', domain: 'a.com', ownerRef: 'rep', updatedAt: '2026-06-01T00:00:00Z', linkedinUrl: null },
        { id: '2', name: 'B', domain: null, ownerRef: null, updatedAt: '2026-06-01T00:00:00Z', linkedinUrl: null },
      ],
      pullContacts: async () => [
        { id: 'c1', firstName: 'J', lastName: 'D', email: 'j@a.com', linkedinUrl: null, companyName: 'A', accountRef: null, ownerRef: 'rep', updatedAt: '2026-06-01T00:00:00Z' },
      ],
      loadPreviousReport: async () => storedReport,
      saveReport: async (client, report) => { saved.report = report; saved.reportClient = client; storedReport = report },
      saveMvd: async (_c, mvd) => { saved.mvd = mvd },
      notify: async (_c, subject, body) => { notifications.push(`${subject}\n${body}`) },
      now: NOW,
    })

    const engine = new PipelineEngine(new MemoryRunStore(), { now: NOW, runId: 'audit-r1' })
    const fresh = parseManifest(readFileSync(templatePath, 'utf8'))
    const parked = await engine.start(pipeline, fresh, 'Acme')

    expect(parked.status).toBe('awaiting_approval')
    expect(parked.gates[0]).toMatchObject({ id: 'monitor:client_comms', status: 'pending' })
    expect(notifications).toHaveLength(0)
    const run = await engine.resolveGate(pipeline, 'audit-r1', 'monitor:client_comms', 'approved', 'gtme@kiln', fresh)
    expect(run.status).toBe('completed')
    expect((saved.report as DataHealthReport).counts.accounts).toBe(2)
    const mvd = saved.mvd as Record<string, MvdStatus>
    expect(mvd['revops.tam']!.status).toBe('red') // 50% domain coverage vs the 80% TAM floor
    expect(mvd['revops.tam']!.blocking_gaps[0]).toMatchObject({ field: 'account_domain_coverage', coverage: 0.5 })
    expect(mvd['revops.remediation']!.status).toBe('green') // remediation never blocked
    expect(notifications).toHaveLength(1)
    expect(notifications[0]).toContain('DRIFT')
  })

  it('audits the canonical refresh view instead of bypassing promotion', async () => {
    let directPulls = 0
    const pipeline = buildEnrichmentRefreshPipeline({
      pullAccounts: async () => { directPulls++; return [] },
      pullContacts: async () => { directPulls++; return [] },
      refreshCanonical: async () => ({
        accounts: [{
          id: 'canonical-a1',
          name: 'Canonical Co',
          domain: 'canonical.co',
          ownerRef: 'rep-1',
          updatedAt: '2026-07-01T00:00:00Z',
          linkedinUrl: null,
        }],
        contacts: [],
      }),
      loadPreviousReport: async () => null,
      saveReport: async () => undefined,
      saveMvd: async () => undefined,
      notify: async () => undefined,
      now: NOW,
    })
    const run = await new PipelineEngine(new MemoryRunStore(), { now: NOW, runId: 'canonical-audit-r1' })
      .start(pipeline, parseManifest(readFileSync(templatePath, 'utf8')), 'Acme')

    expect(directPulls).toBe(0)
    expect((run.checkpoints.audit as DataHealthReport).counts).toEqual({ accounts: 1, contacts: 0 })
  })
})

describe('closed-lost reactivation pipeline', () => {
  const goodGrades = JSON.stringify([
    { id: 'won1', score: 80, labels: { industry: 'Fleet' }, reasoning: 'strong fit' },
    { id: 'low1', score: 20, labels: { industry: 'Other' }, reasoning: 'competitor' },
  ])
  const passReview = JSON.stringify({ batch_score: 90, issues: [], summary: 'ok' })
  const scripted: LlmClient = {
    complete: (() => {
      const queue = [goodGrades, passReview]
      return async () => queue.shift() ?? '[]'
    })(),
  }

  function deps(enrolled: { id: string }[][], loadedClients: string[] = []) {
    return {
      loadCanonicalClosedLost: async (clientId: string) => {
        loadedClients.push(clientId)
        return [
          { id: 'won1', fields: { name: 'FleetCo', description: 'trucks' } },
          { id: 'low1', fields: { name: 'CompetitorCo', description: 'rival' } },
        ]
      },
      graderConfig: {
        brainContext: 'Posture: generous',
        vocabularies: { industry: ['Fleet', 'Other'] },
        reviewerRules: ['competitors score 1-20'],
      },
      llm: scripted,
      tokenUsdPerRow: 0.05,
      minScore: 66,
      playFor: () => ({ play: 'timing-check-in', group: 'fleet', slots: { opp_detail: 'the 500-SIM deal' } }),
      templates: {
        email1: { 'timing-check-in': { subjects: ['Checking in'], body: 'About {opp_detail}, {{first_name}}' } },
        email2: { fleet: { subjects: ['Proof'], body: 'Proof: {proof}' } },
        email3: [{ subjects: ['Bye'], body: 'Last note' }],
        slotDefaults: { proof: 'our platform' },
        fallbackPlay: 'timing-check-in',
        fallbackGroup: 'fleet',
      },
      enroll: async (rows: { id: string }[]) => {
        enrolled.push(rows)
        return rows.length
      },
    }
  }

  it('grades, selects, parks at the outbound gate with a review deck, enrolls on approval', async () => {
    const enrolled: { id: string }[][] = []
    const loadedClients: string[] = []
    const pipeline = buildReactivationPipeline(deps(enrolled, loadedClients))
    const store = new MemoryRunStore()
    const engine = new PipelineEngine(store, { now: NOW, runId: 'r1' })
    const m = manifest('sales.reactivation')

    const parked = await engine.start(pipeline, m, 'Acme')
    expect(parked.status).toBe('awaiting_approval')
    expect(parked.spend.tokensUsd).toBeCloseTo(0.1) // 2 rows × $0.05
    const payload = parked.gates[0]!.payload as { totalRows: number; reviewSample: unknown[] }
    expect(payload.totalRows).toBe(1) // low-scorer filtered out
    expect(payload.reviewSample.length).toBeGreaterThan(0)
    expect(enrolled).toHaveLength(0) // NOTHING sent pre-approval
    expect(loadedClients).toEqual(['Acme'])

    const done = await engine.resolveGate(pipeline, 'r1', 'draft:outbound_send', 'approved', 'gtme@kiln', m)
    expect(done.status).toBe('completed')
    expect(enrolled[0]!.map((r) => r.id)).toEqual(['won1'])
    expect((done.checkpoints.enroll as { enrolled: number }).enrolled).toBe(1)
  })

  it('rejects an unaffordable run before calling the model', async () => {
    let calls = 0
    const pipeline = buildReactivationPipeline({
      ...deps([]),
      llm: { complete: async () => { calls++; return '[]' } },
    })
    const m = manifest('sales.reactivation')
    m.budgets.per_run_defaults.max_tokens_usd = 0.01
    const run = await new PipelineEngine(new MemoryRunStore()).start(pipeline, m, 'Acme')
    expect(run.status).toBe('failed')
    expect(calls).toBe(0)
    expect(run.spend.tokensUsd).toBe(0)
  })
})

describe('data remediation pipeline', () => {
  const report = runDataAudit(
    [
      { id: 'a1', name: 'Ready', domain: 'ready.example', ownerRef: 'rep-1', updatedAt: '2026-07-01T00:00:00Z', linkedinUrl: null },
      { id: 'a2', name: 'Gap', domain: null, ownerRef: null, updatedAt: null, linkedinUrl: null },
    ],
    [],
    { now: NOW() },
  )

  it('prices drafts, snapshots once, gates, and writes only after approval', async () => {
    const snapshots: unknown[][] = []
    const writes: unknown[][] = []
    const clients: string[] = []
    const pipeline = buildRemediationPipeline({
      loadHealthReport: async (clientId) => { clients.push(clientId); return report },
      prepareWrites: async (clientId, plan) => {
        clients.push(clientId)
        expect(plan.tasks.some((task) => task.metric === 'account_domain_coverage')).toBe(true)
        expect(new Set(plan.tasks.flatMap((task) => task.blockedModules))).toEqual(new Set(['revops.enrichment']))
        return {
          writes: [{ object: 'account', externalId: 'a2', fields: { Kiln_Domain__c: 'gap.example' } }],
        }
      },
      crm: {
        snapshot: async (batch) => { snapshots.push(batch); return 'snapshot-1' },
        writeNamespaced: async (batch, snapshotRef) => {
          writes.push(batch)
          return { written: batch.length, rejected: [], snapshotRef }
        },
      },
    })
    const store = new MemoryRunStore()
    const engine = new PipelineEngine(store, { now: NOW, runId: 'remediation-r1' })
    const m = manifest('revops.remediation')

    const parked = await engine.start(pipeline, m, 'Acme')
    expect(parked.status).toBe('awaiting_approval')
    expect(parked.gates[0]).toMatchObject({ id: 'review:crm_write', status: 'pending' })
    expect((parked.gates[0]!.payload as { snapshotRef: string }).snapshotRef).toBe('snapshot-1')
    expect(parked.spend.clayCredits).toBe(2)
    expect(snapshots).toHaveLength(1)
    expect(writes).toHaveLength(0)

    const done = await engine.resolveGate(pipeline, 'remediation-r1', 'review:crm_write', 'approved', 'gtme@kiln', m)
    expect(done.status).toBe('completed')
    expect(snapshots).toHaveLength(1)
    expect(writes).toHaveLength(1)
    expect(clients).toEqual(['Acme', 'Acme'])
    expect(done.checkpoints.write).toMatchObject({ written: 1, snapshotRef: 'snapshot-1' })
  })

  it('fails non-namespaced drafts before snapshot, gate, or CRM write', async () => {
    let snapshots = 0
    let writes = 0
    const pipeline = buildRemediationPipeline({
      loadHealthReport: async () => report,
      prepareWrites: async () => ({
        writes: [{ object: 'account', externalId: 'a2', fields: { Website: 'gap.example' } }],
      }),
      crm: {
        snapshot: async () => { snapshots++; return 'never' },
        writeNamespaced: async () => { writes++; return { written: 0, rejected: [], snapshotRef: 'never' } },
      },
    })
    const run = await new PipelineEngine(new MemoryRunStore(), { now: NOW })
      .start(pipeline, manifest('revops.remediation'), 'Acme')

    expect(run.status).toBe('failed')
    expect(run.journal.some((entry) => entry.detail.includes('non-namespaced'))).toBe(true)
    expect(run.gates).toHaveLength(0)
    expect(snapshots).toBe(0)
    expect(writes).toBe(0)
  })

  it('rejects an unaffordable plan before preparing drafts', async () => {
    let preparations = 0
    const pipeline = buildRemediationPipeline({
      loadHealthReport: async () => report,
      prepareWrites: async () => { preparations++; return { writes: [] } },
      crm: {
        snapshot: async () => 'never',
        writeNamespaced: async () => ({ written: 0, rejected: [], snapshotRef: 'never' }),
      },
    })
    const m = manifest('revops.remediation')
    m.budgets.per_run_defaults.max_clay_credits = 1
    const run = await new PipelineEngine(new MemoryRunStore(), { now: NOW })
      .start(pipeline, m, 'Acme')

    expect(run.status).toBe('failed')
    expect(run.spend.clayCredits).toBe(0)
    expect(preparations).toBe(0)
  })
})

describe('copilot briefs pipeline', () => {
  const input = {
    accountId: 'account-1',
    accountName: 'Acme Fleet',
    generatedAt: '2026-07-09T12:00:00.000Z',
    brainContext: 'ICP: fleet operators. Use a practical voice.',
    evidence: [{
      id: 'activity:meeting-1',
      kind: 'activity' as const,
      observedAt: '2026-07-08T12:00:00Z',
      content: 'The buyer asked about deployment timing.',
    }],
  }
  const validBrief = JSON.stringify({
    status: 'draft',
    accountId: input.accountId,
    generatedAt: input.generatedAt,
    title: 'Acme Fleet meeting brief',
    executiveSummary: [{ text: 'Timing is the active topic.', sourceRefs: ['activity:meeting-1'] }],
    recentSignals: [{ text: 'The buyer asked about deployment timing.', sourceRefs: ['activity:meeting-1'] }],
    openOpportunities: [],
    risks: [],
    recommendedActions: [{ text: 'Clarify the target deployment date.', sourceRefs: ['activity:meeting-1'] }],
    questionsForTheMeeting: [{ text: 'What constrains the deployment date?', sourceRefs: ['activity:meeting-1'] }],
  })

  it('generates once, parks at internal review, and publishes only after approval', async () => {
    let modelCalls = 0
    const published: unknown[][] = []
    const pipeline = buildCopilotBriefsPipeline({
      loadBriefInputs: async (clientId) => [{ ...input, accountName: `${clientId} Fleet` }],
      llm: { complete: async () => { modelCalls++; return validBrief } },
      tokenUsdPerBrief: 0.05,
      publishBriefs: async (_clientId, briefs) => { published.push(briefs); return briefs.length },
    })
    const store = new MemoryRunStore()
    const engine = new PipelineEngine(store, { now: NOW, runId: 'brief-r1' })
    const m = manifest('sales.copilot-briefs')

    const parked = await engine.start(pipeline, m, 'Acme')
    expect(parked.status).toBe('awaiting_approval')
    expect(parked.gates[0]).toMatchObject({ id: 'review:internal_report', status: 'pending' })
    expect(parked.spend.tokensUsd).toBeCloseTo(0.05)
    expect(modelCalls).toBe(1)
    expect(published).toHaveLength(0)

    const done = await engine.resolveGate(pipeline, 'brief-r1', 'review:internal_report', 'approved', 'gtme@kiln', m)
    expect(done.status).toBe('completed')
    expect(modelCalls).toBe(1)
    expect(published).toHaveLength(1)
    expect(done.checkpoints.publish).toMatchObject({ published: 1, failed: 0 })
  })

  it('rejects an unaffordable batch before calling the model', async () => {
    let modelCalls = 0
    const pipeline = buildCopilotBriefsPipeline({
      loadBriefInputs: async () => [input],
      llm: { complete: async () => { modelCalls++; return validBrief } },
      tokenUsdPerBrief: 0.05,
      publishBriefs: async () => 0,
    })
    const m = manifest('sales.copilot-briefs')
    m.budgets.per_run_defaults.max_tokens_usd = 0.01
    const run = await new PipelineEngine(new MemoryRunStore(), { now: NOW })
      .start(pipeline, m, 'Acme')

    expect(run.status).toBe('failed')
    expect(run.spend.tokensUsd).toBe(0)
    expect(modelCalls).toBe(0)
  })
})

describe('inbound routing pipeline', () => {
  it('enriches through the cache, routes with reasoning, gates the CRM write', async () => {
    const cache = new EnrichmentCache(new MemoryCacheStore(), NOW)
    await cache.record('bigco.com', {
      revenue_usd: { value: 2e8, provenance: { source: 'enrichment', origin: 'clay', retrievedAt: '2026-07-01T00:00:00Z', confidence: 'high' } },
    })
    const written: unknown[] = []
    const pipeline = buildInboundRoutingPipeline({
      pullNewLeads: async () => [
        { id: 'l1', domain: 'bigco.com', name: 'BigCo', raw: { country: 'US', state: 'TX' } },
        { id: 'l2', domain: null, name: 'NoDomain Co', raw: { country: 'US' } },
      ],
      enrichment: { cache },
      fieldsWanted: ['revenue_usd'],
      clayCreditsPerProviderCall: 2,
      routingRules: {
        rules: [
          {
            id: 'tx-large',
            description: 'TX $100M+',
            when: { all: [{ field: 'state', op: 'eq', value: 'TX' }, { field: 'revenue_usd', op: 'gte', value: 1e8 }] },
            action: { type: 'assign', owner: 'AE Texas' },
          },
          {
            id: 'no-rev',
            description: 'unknown revenue',
            when: { field: 'revenue_usd', op: 'missing' },
            action: { type: 'manual_review', reason: 'research revenue' },
          },
        ],
        defaultOwner: 'Shawn',
      },
      toRoutingFields: (lead, enriched) => ({
        ...lead.raw,
        revenue_usd: (enriched.values.revenue_usd?.value as number | null) ?? null,
      }),
      writeAssignments: async (assignments) => {
        written.push(...assignments)
        return assignments.length
      },
    })

    const store = new MemoryRunStore()
    const engine = new PipelineEngine(store, { now: NOW, runId: 'r1' })
    const m = manifest('marketing.inbound')

    const parked = await engine.start(pipeline, m, 'Acme')
    expect(parked.status).toBe('awaiting_approval')
    const payload = parked.gates[0]!.payload as {
      assignments: { id: string; owner: string; reasoning: string }[]
      manualReview: { id: string }[]
    }
    expect(payload.assignments).toEqual([
      expect.objectContaining({ id: 'l1', owner: 'AE Texas', reasoning: expect.stringContaining('tx-large') }),
    ])
    expect(payload.manualReview.map((r) => r.id)).toEqual(['l2'])
    expect(written).toHaveLength(0) // no CRM write pre-approval

    const done = await engine.resolveGate(pipeline, 'r1', 'writeback:crm_write', 'approved', 'gtme@kiln', m)
    expect(done.status).toBe('completed')
    expect(written).toHaveLength(1)
    expect((done.checkpoints.writeback as { written: number }).written).toBe(1)
  })

  it('honors a zero-credit cap before calling the provider', async () => {
    let providerCalls = 0
    const cache = new EnrichmentCache(new MemoryCacheStore(), NOW)
    const pipeline = buildInboundRoutingPipeline({
      pullNewLeads: async () => [{ id: 'l1', domain: 'new.io', name: 'New', raw: {} }],
      enrichment: { cache, provider: async () => { providerCalls++; return {} } },
      fieldsWanted: ['industry'],
      clayCreditsPerProviderCall: 2,
      routingRules: { rules: [], defaultOwner: null },
      toRoutingFields: () => ({}),
      writeAssignments: async () => 0,
    })
    const m = manifest('marketing.inbound')
    m.budgets.per_run_defaults.max_clay_credits = 0
    const run = await new PipelineEngine(new MemoryRunStore()).start(pipeline, m, 'Acme')
    expect(providerCalls).toBe(0)
    expect(run.spend.clayCredits).toBe(0)
    expect((run.checkpoints.enrich as { budgetExhaustedRowIds: string[] }).budgetExhaustedRowIds).toEqual(['l1'])
  })
})
