import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseManifest } from '@sartre/core'
import type { MvdStatus } from '@sartre/core'
import { EnrichmentCache, MemoryCacheStore } from '@sartre/connectors'
import type { DataHealthReport } from '@sartre/data'
import { MemoryRunStore, PipelineEngine } from '@sartre/pipelines'
import type { LlmClient } from '@sartre/skills'
import {
  buildEnrichmentRefreshPipeline,
  buildInboundRoutingPipeline,
  buildReactivationPipeline,
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

    const pipeline = buildEnrichmentRefreshPipeline({
      pullAccounts: async () => [
        { id: '1', name: 'A', domain: 'a.com', ownerRef: 'rep', updatedAt: '2026-06-01T00:00:00Z', linkedinUrl: null },
        { id: '2', name: 'B', domain: null, ownerRef: null, updatedAt: '2026-06-01T00:00:00Z', linkedinUrl: null },
      ],
      pullContacts: async () => [
        { id: 'c1', firstName: 'J', lastName: 'D', email: 'j@a.com', linkedinUrl: null, companyName: 'A', accountRef: null, ownerRef: 'rep', updatedAt: '2026-06-01T00:00:00Z' },
      ],
      loadPreviousReport: async () => previousReport,
      saveReport: async (client, report) => { saved.report = report; saved.reportClient = client },
      saveMvd: async (_c, mvd) => { saved.mvd = mvd },
      notify: async (_c, subject, body) => { notifications.push(`${subject}\n${body}`) },
      now: NOW,
    })

    const engine = new PipelineEngine(new MemoryRunStore(), { now: NOW })
    const run = await engine.start(pipeline, manifest('revops.enrichment'), 'Acme')

    expect(run.status).toBe('completed')
    expect((saved.report as DataHealthReport).counts.accounts).toBe(2)
    const mvd = saved.mvd as Record<string, MvdStatus>
    expect(mvd['revops.tam']!.status).toBe('red') // 50% domain coverage vs the 80% TAM floor
    expect(mvd['revops.tam']!.blocking_gaps[0]).toMatchObject({ field: 'account_domain_coverage', coverage: 0.5 })
    expect(mvd['revops.remediation']!.status).toBe('green') // remediation never blocked
    expect(notifications).toHaveLength(1)
    expect(notifications[0]).toContain('DRIFT')
    expect(notifications[0]).toContain('CONTRACT')
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

  function deps(enrolled: { id: string }[][]) {
    return {
      pullClosedLost: async () => [
        { id: 'won1', fields: { name: 'FleetCo', description: 'trucks' } },
        { id: 'low1', fields: { name: 'CompetitorCo', description: 'rival' } },
      ],
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
    const pipeline = buildReactivationPipeline(deps(enrolled))
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

    const done = await engine.resolveGate(pipeline, 'r1', 'draft:outbound_send', 'approved', 'gtme@kiln', m)
    expect(done.status).toBe('completed')
    expect(enrolled[0]!.map((r) => r.id)).toEqual(['won1'])
    expect((done.checkpoints.enroll as { enrolled: number }).enrolled).toBe(1)
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
})
