import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseManifest } from '@sartre/core'
import type { HumanActionEvent } from '@sartre/core'
import { MemoryRunStore, PipelineEngine } from '../src/index.js'
import type { PipelineDefinition } from '../src/index.js'

const templatePath = resolve(import.meta.dirname, '../../../clients/_template/client.yaml')

function manifestWith(mutate: (m: ReturnType<typeof parseManifest>) => void) {
  const m = parseManifest(readFileSync(templatePath, 'utf8'))
  // enable the module pipelines run on, green MVD
  m.modules['revops.enrichment']!.enabled = true
  m.mvd['revops.enrichment'] = { status: 'green', as_of: '2026-07-09', blocking_gaps: [] }
  mutate(m)
  return m
}

const NOW = () => new Date('2026-07-09T12:00:00Z')

function pipeline(steps: PipelineDefinition['steps']): PipelineDefinition {
  return { id: 'test-pipeline@0.1.0', moduleId: 'revops.enrichment', steps }
}

describe('PipelineEngine', () => {
  it('runs steps in order, checkpoints outputs, completes', async () => {
    const store = new MemoryRunStore()
    const engine = new PipelineEngine(store, { now: NOW, runId: 'r1' })
    const manifest = manifestWith(() => {})
    const run = await engine.start(
      pipeline([
        { id: 'a', run: async () => 'A-out' },
        { id: 'b', run: async (ctx) => `${ctx.outputs.a}-B` },
      ]),
      manifest,
      'client-x',
    )
    expect(run.status).toBe('completed')
    expect(run.checkpoints).toEqual({ a: 'A-out', b: 'A-out-B' })
    expect(run.journal.map((j) => j.event)).toContain('run_completed')
  })

  it('never starts a run whose module fails the MVD gate', async () => {
    const engine = new PipelineEngine(new MemoryRunStore(), { now: NOW })
    const manifest = manifestWith((m) => {
      m.mvd['revops.enrichment'] = {
        status: 'red',
        as_of: '2026-07-09',
        blocking_gaps: [{ field: 'account_domain_coverage', coverage: 0.4, required: 0.7, remediation_credits: 100 }],
      }
    })
    let ran = false
    const run = await engine.start(pipeline([{ id: 'a', run: async () => (ran = true) }]), manifest, 'c')
    expect(run.status).toBe('blocked')
    expect(ran).toBe(false)
    expect(run.journal[0]!.detail).toContain('account_domain_coverage')
  })

  it('resumes a crashed run without re-executing completed steps', async () => {
    const store = new MemoryRunStore()
    const engine = new PipelineEngine(store, { now: NOW, runId: 'r1' })
    const manifest = manifestWith(() => {})
    const executions: string[] = []
    let failOnce = true
    const def = pipeline([
      { id: 'a', run: async () => { executions.push('a'); return 1 } },
      {
        id: 'b',
        run: async () => {
          executions.push('b')
          if (failOnce) { failOnce = false; throw new Error('transient') }
          return 2
        },
      },
    ])
    const first = await engine.start(def, manifest, 'c')
    expect(first.status).toBe('failed')

    const resumed = await engine.resume(def, 'r1', manifest)
    expect(resumed.status).toBe('completed')
    expect(executions).toEqual(['a', 'b', 'b']) // a ran once, b retried
  })

  it('enforces per-run credit budgets as a hard stop', async () => {
    const engine = new PipelineEngine(new MemoryRunStore(), { now: NOW })
    const manifest = manifestWith((m) => {
      m.budgets.per_run_defaults.max_clay_credits = 100
    })
    const run = await engine.start(
      pipeline([
        {
          id: 'enrich',
          run: async (ctx) => {
            ctx.spendCredits(60, 'first batch')
            ctx.spendCredits(60, 'second batch') // 120 > 100 → throws
            return 'never'
          },
        },
      ]),
      manifest,
      'c',
    )
    expect(run.status).toBe('failed')
    expect(run.spend.clayCredits).toBe(120)
    expect(run.journal.some((j) => j.event === 'budget_exceeded')).toBe(true)
  })

  it('blocks at a human gate, resumes on approval, emits a feedback event', async () => {
    const store = new MemoryRunStore()
    const events: HumanActionEvent[] = []
    const engine = new PipelineEngine(store, {
      now: NOW,
      runId: 'r1',
      onFeedbackEvent: (e) => { events.push(e) },
    })
    const manifest = manifestWith(() => {}) // outbound_send: block (template default)
    const def = pipeline([
      {
        id: 'draft',
        run: async (ctx) => {
          const emails = ['email 1', 'email 2']
          await ctx.gate('outbound_send', emails)
          return emails
        },
      },
      { id: 'send', run: async () => 'sent' },
    ])

    const parked = await engine.start(def, manifest, 'client-x')
    expect(parked.status).toBe('awaiting_approval')
    expect(parked.gates[0]).toMatchObject({ id: 'draft:outbound_send', status: 'pending' })
    expect(parked.checkpoints).toEqual({}) // gated step not checkpointed

    const resumed = await engine.resolveGate(def, 'r1', 'draft:outbound_send', 'approved', 'gtme@kiln', manifest)
    expect(resumed.status).toBe('completed')
    expect(resumed.checkpoints.send).toBe('sent')

    // Layer 8: the approval is a labeled training example
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'human_action',
      action: 'approve',
      actor: 'gtme@kiln',
      clientId: 'client-x',
      machine: { runId: 'r1', itemRef: 'draft:outbound_send' },
    })
  })

  it('terminates the run on gate rejection with a reject feedback event', async () => {
    const store = new MemoryRunStore()
    const events: HumanActionEvent[] = []
    const engine = new PipelineEngine(store, { now: NOW, runId: 'r1', onFeedbackEvent: (e) => { events.push(e) } })
    const manifest = manifestWith(() => {})
    let sent = false
    const def = pipeline([
      {
        id: 'draft',
        run: async (ctx) => {
          await ctx.gate('outbound_send', 'bad copy')
          return 'x'
        },
      },
      { id: 'send', run: async () => { sent = true; return true } },
    ])
    await engine.start(def, manifest, 'c')
    const rejected = await engine.resolveGate(def, 'r1', 'draft:outbound_send', 'rejected', 'gtme@kiln', manifest, 'tone off-brand')
    expect(rejected.status).toBe('rejected')
    expect(sent).toBe(false)
    expect(events[0]).toMatchObject({ action: 'reject', reason: 'tone off-brand' })
  })

  it('notify policy journals and continues; auto is silent', async () => {
    const engine = new PipelineEngine(new MemoryRunStore(), { now: NOW })
    const manifest = manifestWith((m) => {
      m.policies.approval.crm_write = 'notify'
      m.policies.approval.internal_report = 'auto'
    })
    const run = await engine.start(
      pipeline([
        {
          id: 'write',
          run: async (ctx) => {
            await ctx.gate('crm_write', { fields: 1 })
            await ctx.gate('internal_report', 'report')
            return 'done'
          },
        },
      ]),
      manifest,
      'c',
    )
    expect(run.status).toBe('completed')
    expect(run.gates).toHaveLength(1) // notify recorded, auto not
    expect(run.gates[0]).toMatchObject({ outputClass: 'crm_write', status: 'approved', resolvedBy: 'policy:notify' })
  })

  it('honors an attributed MVD override', async () => {
    const engine = new PipelineEngine(new MemoryRunStore(), { now: NOW })
    const manifest = manifestWith((m) => {
      m.mvd['revops.enrichment'] = { status: 'yellow', as_of: '2026-07-09', blocking_gaps: [] }
      m.modules['revops.enrichment']!.override_mvd = { reason: 'pilot accepts risk', approved_by: 'GTME' }
    })
    const run = await engine.start(pipeline([{ id: 'a', run: async () => 1 }]), manifest, 'c')
    expect(run.status).toBe('completed')
    expect(run.journal[0]!.detail).toContain('overridden by GTME')
  })
})
