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

  it('routes declared effects through the durable ledger with a run-scoped idempotency key', async () => {
    const calls: Array<{ clientId: string; key: string; payload: unknown }> = []
    let performed = 0
    const engine = new PipelineEngine(new MemoryRunStore(), {
      now: NOW,
      runId: 'effect-r1',
      effects: {
        execute: async (clientId, key, payload, perform) => {
          calls.push({ clientId, key, payload })
          return perform()
        },
      },
    })
    const run = await engine.start(pipeline([
      { id: 'prepare', run: async () => ({ id: 'A1' }) },
      { id: 'write', effect: true, run: async () => { performed++; return { written: 1 } } },
    ]), manifestWith(() => {}), 'Acme')

    expect(run.status).toBe('completed')
    expect(performed).toBe(1)
    expect(calls).toEqual([{
      clientId: 'Acme',
      key: 'effect-r1:write',
      payload: { pipelineId: 'test-pipeline@0.1.0', stepId: 'write', inputs: { prepare: { id: 'A1' } } },
    }])
  })

  it('traces each pipeline step with tenant and run attributes', async () => {
    const spans: Array<{ name: string; attributes: Record<string, string | number | boolean> }> = []
    const engine = new PipelineEngine(new MemoryRunStore(), {
      now: NOW, runId: 'trace-r1',
      telemetry: { span: async (name, attributes, operation) => { spans.push({ name, attributes }); return operation() } },
    })
    await engine.start(pipeline([{ id: 'prepare', run: async () => 'ok' }]), manifestWith(() => {}), 'Acme')
    expect(spans).toEqual([{ name: 'pipeline.step', attributes: {
      'sartre.client_id': 'Acme', 'sartre.run_id': 'trace-r1', 'sartre.pipeline_id': 'test-pipeline@0.1.0', 'sartre.step_id': 'prepare',
    } }])
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
    expect(run.spend.clayCredits).toBe(60) // rejected spend is never booked
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
    expect(resumed.feedbackEvents).toHaveLength(1) // durable with the gate transition

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

  it('allows only one competing decision to transition a pending gate', async () => {
    const store = new MemoryRunStore()
    const engine = new PipelineEngine(store, { now: NOW, runId: 'r1' })
    const manifest = manifestWith(() => {})
    const def = pipeline([{ id: 'draft', run: async (ctx) => { await ctx.gate('outbound_send', 'copy'); return 'copy' } }])
    await engine.start(def, manifest, 'c')
    const decisions = await Promise.allSettled([
      store.decideGate({ runId: 'r1', gateId: 'draft:outbound_send', decision: 'approved', actor: 'a', resolvedAt: NOW().toISOString() }),
      store.decideGate({ runId: 'r1', gateId: 'draft:outbound_send', decision: 'rejected', actor: 'b', resolvedAt: NOW().toISOString() }),
    ])
    expect(decisions.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(decisions.filter((result) => result.status === 'rejected')).toHaveLength(1)
  })

  it('blocks at every declared gate; no policy can auto-approve', async () => {
    const store = new MemoryRunStore()
    const engine = new PipelineEngine(store, { now: NOW, runId: 'r1' })
    const manifest = manifestWith(() => {})
    const def = pipeline([{ id: 'report', run: async (ctx) => { await ctx.gate('internal_report', 'report'); return 'done' } }])
    const parked = await engine.start(def, manifest, 'c')
    expect(parked.status).toBe('awaiting_approval')
    expect(parked.gates[0]).toMatchObject({ outputClass: 'internal_report', status: 'pending', resolvedBy: null })
    expect((await engine.resolveGate(def, 'r1', 'report:internal_report', 'approved', 'gtme', manifest)).status).toBe('completed')
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

  it('does not resume an approved effect after the subscription becomes inactive', async () => {
    const store = new MemoryRunStore()
    const engine = new PipelineEngine(store, { now: NOW, runId: 'commercial-r1' })
    const manifest = manifestWith(() => {})
    let sent = false
    const def = pipeline([
      { id: 'review', run: async (ctx) => { await ctx.gate('outbound_send', 'copy'); return 'copy' } },
      { id: 'send', run: async () => { sent = true; return 'sent' } },
    ])
    await engine.start(def, manifest, 'Acme')
    const parked = await store.get('commercial-r1')
    parked!.gates[0]!.status = 'approved'
    parked!.gates[0]!.resolvedBy = 'client'
    await store.save(parked!)
    manifest.commercial.status = 'past_due'

    const blocked = await engine.resume(def, 'commercial-r1', manifest)
    expect(blocked.status).toBe('blocked')
    expect(blocked.journal.at(-1)!.detail).toContain('commercial status past_due')
    expect(sent).toBe(false)
  })

  it('applies commercial blocking to data-audit preflight and direct gate resolution', async () => {
    const manifest = manifestWith(() => {})
    manifest.commercial.status = 'canceled'
    const audit = { ...pipeline([{ id: 'audit', run: async () => 'ran' }]), preflight: 'data_audit' as const }
    const auditRun = await new PipelineEngine(new MemoryRunStore(), { now: NOW }).start(audit, manifest, 'Acme')
    expect(auditRun.status).toBe('blocked')

    manifest.commercial.status = 'active'
    const store = new MemoryRunStore()
    let sent = false
    const def = pipeline([
      { id: 'review', run: async (ctx) => { await ctx.gate('outbound_send', 'copy'); return 'copy' } },
      { id: 'send', run: async () => { sent = true; return 'sent' } },
    ])
    const engine = new PipelineEngine(store, { now: NOW, runId: 'direct-commercial-r1' })
    await engine.start(def, manifest, 'Acme')
    manifest.commercial.status = 'past_due'
    const blocked = await engine.resolveGate(def, 'direct-commercial-r1', 'review:outbound_send', 'approved', 'client', manifest)
    expect(blocked.status).toBe('blocked')
    expect(sent).toBe(false)
  })
})
