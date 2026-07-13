import { describe, expect, it } from 'vitest'
import type { HumanActionEvent } from '@sartre/core'
import {
  computeReviewMetrics,
  extractExemplars,
  gateProposals,
  isoWeek,
  metricsByPeriod,
  proposeTuning,
  renderTuningReport,
} from '../src/index.js'

let seq = 0
function event(over: Partial<HumanActionEvent>): HumanActionEvent {
  seq++
  return {
    kind: 'human_action',
    id: `evt-${seq}`,
    clientId: 'Acme',
    occurredAt: '2026-07-09T12:00:00Z',
    actor: 'gtme@kiln',
    action: 'approve',
    machine: { skillId: 'list-grader@0.1.0', runId: 'r1', itemRef: `item-${seq}`, output: null },
    surface: 'review_queue',
    ...over,
  }
}

describe('extractExemplars (speed 1)', () => {
  it('turns reasoned corrections into draft exemplar files', () => {
    const events = [
      event({
        action: 'grade_override',
        reason: 'MedCo is a known competitor — auto-fail',
        machine: { skillId: 'list-grader@0.1.0', runId: 'r1', itemRef: 'acct-123', output: { score: 70 } },
        humanOutput: { score: 10 },
      }),
      event({ action: 'approve' }), // approvals aren't lessons
      event({ action: 'grade_override' }), // no reason → metric, not lesson
    ]
    const exemplars = extractExemplars(events, 'Acme')
    expect(exemplars).toHaveLength(1)
    expect(exemplars[0]).toMatchObject({ teaches: 'grading' })
    expect(exemplars[0]!.markdown).toContain('status: draft')
    expect(exemplars[0]!.markdown).toContain('known competitor')
    expect(exemplars[0]!.markdown).toContain('"score": 10')
    expect(exemplars[0]!.markdown).toContain('approved_by: ""') // human gate intact
  })

  it('routes reasoned rejections to the brain area implied by the gate', () => {
    const exemplars = extractExemplars([
      event({
        action: 'reject',
        reason: 'Tone is too aggressive',
        machine: { skillId: 'campaign-factory@0.1.0', runId: 'r2', itemRef: 'draft:outbound_send', output: {} },
      }),
      event({
        action: 'reject',
        reason: 'Informational report is stale',
        machine: { skillId: 'metrics@0.1.0', runId: 'r3', itemRef: 'report:internal_report', output: {} },
      }),
    ], 'Acme')
    expect(exemplars).toHaveLength(1)
    expect(exemplars[0]!.teaches).toBe('voice')
  })
})

describe('proposeTuning (speed 2)', () => {
  const gradeOverride = (machineScore: number, humanScore: number, industry?: string) =>
    event({
      action: 'grade_override',
      machine: {
        skillId: 'list-grader@0.1.0',
        runId: 'r1',
        itemRef: `i${seq}`,
        output: { score: machineScore, labels: industry ? { industry } : {} },
      },
      humanOutput: { score: humanScore },
    })

  it('detects systematic grading bias', () => {
    const events = Array.from({ length: 10 }, () => gradeOverride(50, 65))
    const proposals = proposeTuning(events)
    expect(proposals.some((p) => p.kind === 'grading_bias')).toBe(true)
    const bias = proposals.find((p) => p.kind === 'grading_bias')!
    expect(bias.summary).toContain('lower than reviewers')
    expect(bias.evidence.sampleSize).toBe(10)
  })

  it('detects per-segment bias', () => {
    const events = [
      ...Array.from({ length: 8 }, () => gradeOverride(40, 70, 'Healthcare')),
      // balanced noise elsewhere keeps the global signal quiet
      ...Array.from({ length: 4 }, () => gradeOverride(60, 50, 'Fleet')),
      ...Array.from({ length: 4 }, () => gradeOverride(50, 60, 'Fleet')),
    ]
    const proposals = proposeTuning(events)
    const seg = proposals.find((p) => p.kind === 'grading_segment')
    expect(seg).toBeDefined()
    expect(seg!.summary).toContain('Healthcare')
    expect(seg!.evidence.sampleSize).toBe(8)
  })

  it('detects the routing-override cluster (the PLAN example)', () => {
    // "14 routing overrides near the $100M threshold — proposed rule change attached"
    const events = Array.from({ length: 14 }, () =>
      event({
        action: 'routing_correction',
        machine: { skillId: 'router@0.1.0', runId: 'r2', itemRef: `lead-${seq}`, output: { owner: 'Shawn' } },
        humanOutput: { owner: 'Jon Liebe' },
      }),
    )
    const proposals = proposeTuning(events)
    const routing = proposals.find((p) => p.kind === 'routing_rule')
    expect(routing).toBeDefined()
    expect(routing!.summary).toBe('14 routing overrides reassigning Shawn → Jon Liebe')
    expect(routing!.target).toBe('brain/routing.md')
    expect(routing!.evidence.sampleSize).toBe(14)
  })

  it('stays silent below the sample threshold — no proposals from noise', () => {
    const events = [gradeOverride(50, 90), gradeOverride(50, 95)]
    expect(proposeTuning(events)).toEqual([])
  })

  it('eval gate annotates instead of silently dropping', async () => {
    const events = Array.from({ length: 10 }, () => gradeOverride(50, 65))
    const gated = await gateProposals(proposeTuning(events), async () => ({
      pass: false,
      detail: '2 known-answer evals regress',
    }))
    expect(gated[0]!.evalResult).toEqual({ pass: false, detail: '2 known-answer evals regress' })
  })

  it('renders a reviewable weekly report', () => {
    const events = Array.from({ length: 10 }, () => gradeOverride(50, 65))
    const report = renderTuningReport('Acme', '2026-07-09', proposeTuning(events))
    expect(report).toContain('# Weekly Tuning Proposals — Acme')
    expect(report).toContain('nothing applies automatically')
    expect(report).toContain('brain/grading.md')
  })
})

describe('computeReviewMetrics', () => {
  it('computes the QBR numbers', () => {
    const events = [
      event({ action: 'approve' }),
      event({ action: 'approve' }),
      event({ action: 'approve_with_edit' }),
      event({ action: 'grade_override' }),
      event({ action: 'brain_edit' }), // not a review decision
    ]
    const m = computeReviewMetrics(events)
    expect(m.events).toBe(4)
    expect(m.approveRate).toBe(0.5)
    expect(m.approveWithEditRate).toBe(0.25)
    expect(m.overrideRate).toBe(0.25)
    expect(m.byPipeline['list-grader@0.1.0']!.events).toBe(4)
  })

  it('produces the declining-correction series per ISO week', () => {
    const events = [
      event({ action: 'grade_override', occurredAt: '2026-06-29T10:00:00Z' }), // W27
      event({ action: 'approve', occurredAt: '2026-06-30T10:00:00Z' }),
      event({ action: 'approve', occurredAt: '2026-07-06T10:00:00Z' }), // W28
      event({ action: 'approve', occurredAt: '2026-07-07T10:00:00Z' }),
    ]
    const series = metricsByPeriod(events)
    expect(series.map((s) => s.period)).toEqual(['2026-W27', '2026-W28'])
    expect(series[0]!.metrics.approveRate).toBe(0.5)
    expect(series[1]!.metrics.approveRate).toBe(1) // learning visibly working
  })

  it('isoWeek handles year boundaries', () => {
    expect(isoWeek('2026-01-01T00:00:00Z')).toBe('2026-W01')
    expect(isoWeek('2024-12-30T00:00:00Z')).toBe('2025-W01') // Mon of W1 2025
  })
})
