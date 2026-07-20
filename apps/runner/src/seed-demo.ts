import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseManifest } from '@sartre/core'
import { PipelineEngine } from '@sartre/pipelines'
import type { RunStore } from '@sartre/pipelines'
import type { LlmClient } from '@sartre/skills'
import { buildAbmPipeline, buildTakeoutPipeline, buildEventsPipeline, buildTamPipeline } from '@sartre/modules'

/**
 * Demo seeding for the local click-through. It drives the four brain-grounded
 * strategy pipelines (ABM, competitive takeout, event follow-up, TAM) through
 * the real PipelineEngine with a scripted fake LLM, so each run parks at its
 * human review gate exactly as production would — the review queue then renders
 * the seeded plans. No live model or provider is contacted.
 */

export const DEMO_CLIENT_ID = 'Demo Co'

const DEMO_BRAIN = [
  'ICP: $100M+ logistics and fleet operators. Fit tiers: A strong, B moderate, C weak.',
  'Hard disqualifier: government entities.',
  'Use cases: fleet visibility, dispatch automation. Voice: direct, concrete, no hype.',
  'Proof points: cut idle time 18% (case study: Northwind Freight).',
].join('\n')

/** Scripted stand-in for the production model — returns a valid plan per strategy skill. */
export const demoLlm: LlmClient = {
  complete: async ({ system, user }) => {
    if (system.includes('ABM play')) {
      if (user.includes('"gov-1"')) {
        return JSON.stringify({ play: 'none', rationale: 'Government entity — hard disqualifier', contacts: [], skip: true, status: 'draft' })
      }
      return JSON.stringify({ play: 'fleet-visibility', rationale: 'Mid-market logistics; strong fit for the fleet visibility use case', contacts: ['Dana Reyes, VP Ops'], skip: false, status: 'draft' })
    }
    if (system.includes('competitive takeout')) {
      return JSON.stringify({ angle: 'renewal timing', proof: 'Renewal with Fleetio in Q3 per CRM note', draft: 'Worth a 20-minute comparison before your Q3 renewal? Northwind cut idle time 18% after switching.', status: 'draft' })
    }
    if (system.includes('event follow-up')) {
      return JSON.stringify({ draft: 'Thanks for stopping by our booth at FleetSummit — here is the fleet-visibility overview we discussed.', status: 'draft' })
    }
    // TAM scoring
    return JSON.stringify({ score: 84, tier: 'A', reasons: ['Revenue ~$180M clears the $100M ICP floor', 'Logistics vertical matches core use case'], plays: ['fleet-visibility'] })
  },
}

interface DemoSeedResult { moduleId: string; runId: string; status: string }

function demoManifest(templatePath: string, moduleId: string) {
  const manifest = parseManifest(readFileSync(templatePath, 'utf8'))
  manifest.status = 'active'
  manifest.modules[moduleId] = { enabled: true, always_on: false, thresholds: {} }
  manifest.mvd[moduleId] = { status: 'green', as_of: '2026-07-20', blocking_gaps: [] }
  return manifest
}

/**
 * Park one awaiting-approval run per strategy module in the given store.
 * Exported for tests (drive it against PGlite) and for the CLI (drive it
 * against Postgres). Returns the seeded run ids and statuses.
 */
export async function seedDemoRuns(
  store: RunStore,
  options: { clientId?: string; llm?: LlmClient; templatePath?: string; now?: () => Date } = {},
): Promise<DemoSeedResult[]> {
  const clientId = options.clientId ?? DEMO_CLIENT_ID
  const llm = options.llm ?? demoLlm
  const now = options.now ?? (() => new Date('2026-07-20T12:00:00Z'))
  const templatePath = options.templatePath ?? resolve(import.meta.dirname, '../../../clients/_template/client.yaml')
  const brainContext = async () => DEMO_BRAIN

  const abm = buildAbmPipeline(() => ({
    loadAccounts: async () => ({ accounts: [
      { id: 'acc-1', name: 'Northwind Freight', fields: { contacts: ['Dana Reyes, VP Ops'], revenue: 180 } },
      { id: 'gov-1', name: 'State DOT', fields: {} },
    ] }),
    brainContext, llm, tokenUsdPerPlan: 0.07,
    activate: async () => ({ affected: 0 }),
  }))
  const takeout = buildTakeoutPipeline(() => ({
    loadCandidates: async () => [
      { accountId: 'acc-2', accountName: 'Cascade Logistics', competitor: 'Fleetio', evidence: ['Renewal with Fleetio in Q3 per CRM note'] },
    ],
    brainContext, llm, tokenUsdPerPlay: 0.08,
    activate: async () => ({ affected: 0 }),
  }))
  const events = buildEventsPipeline(() => ({
    loadAttendees: async () => [
      { id: 'evt-1', email: 'buyer@cascade.example', event: 'FleetSummit', attended: true, segment: 'enterprise' },
    ],
    brainContext, llm, tokenUsdPerDraft: 0.04,
    send: async () => ({ affected: 0 }),
  }))
  const tam = buildTamPipeline(() => ({
    loadAccounts: async () => [
      { id: 'acc-3', name: 'Summit Haulage', fields: { revenue: 180, vertical: 'logistics' } },
    ],
    brainContext, llm, tokenUsdPerScore: 0.04,
    writeScores: async () => ({ affected: 0 }),
  }))

  const jobs: Array<{ moduleId: string; pipeline: ReturnType<typeof buildAbmPipeline>; runId: string }> = [
    { moduleId: 'sales.abm', pipeline: abm, runId: 'demo-abm' },
    { moduleId: 'sales.takeout', pipeline: takeout, runId: 'demo-takeout' },
    { moduleId: 'marketing.events', pipeline: events, runId: 'demo-events' },
    { moduleId: 'revops.tam', pipeline: tam, runId: 'demo-tam' },
  ]

  const results: DemoSeedResult[] = []
  for (const job of jobs) {
    const run = await new PipelineEngine(store, { runId: job.runId, now }).start(job.pipeline, demoManifest(templatePath, job.moduleId), clientId)
    results.push({ moduleId: job.moduleId, runId: run.runId, status: run.status })
  }
  return results
}
