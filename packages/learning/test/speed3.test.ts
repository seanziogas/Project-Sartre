import { describe, expect, it } from 'vitest'
import type { OutcomeEvent } from '@sartre/core'
import {
  aggregateOutcomes,
  recalibrateIcp,
  renderAllocationReport,
  renderCalibrationReport,
  renderEngagementReport,
  seededRng,
  thompsonAllocate,
} from '../src/index.js'

let seq = 0
function outcome(kind: OutcomeEvent['outcome'], runId: string): OutcomeEvent {
  seq++
  return {
    kind: 'outcome',
    id: `out-${seq}`,
    clientId: 'Acme',
    occurredAt: '2026-07-09T12:00:00Z',
    outcome: kind,
    accountId: null,
    contactId: null,
    opportunityId: null,
    attributedRunIds: [runId],
  }
}

describe('aggregateOutcomes + thompsonAllocate (speed 3a)', () => {
  it('aggregates by variant and allocates toward the winner', () => {
    const events = [
      ...Array.from({ length: 12 }, () => outcome('reply_positive', 'play:timing')),
      ...Array.from({ length: 28 }, () => outcome('reply_negative', 'play:timing')),
      ...Array.from({ length: 2 }, () => outcome('reply_positive', 'play:pricing')),
      ...Array.from({ length: 38 }, () => outcome('reply_negative', 'play:pricing')),
    ]
    const stats = aggregateOutcomes(events, (e) => e.attributedRunIds[0] ?? null)
    expect(stats).toEqual([
      { variant: 'play:pricing', successes: 2, failures: 38 },
      { variant: 'play:timing', successes: 12, failures: 28 },
    ])

    const alloc = thompsonAllocate(stats, { rng: seededRng(42) })
    expect(alloc[0]!.variant).toBe('play:timing') // 30% rate beats 5%
    expect(alloc[0]!.share).toBeGreaterThan(0.85)
    expect(alloc[1]!.share).toBeGreaterThanOrEqual(0.05) // observability floor
    expect(alloc.reduce((s, a) => s + a.share, 0)).toBeCloseTo(1, 1)
  })

  it('splits roughly evenly with no evidence, deterministic under a seed', () => {
    const stats = [
      { variant: 'a', successes: 0, failures: 0 },
      { variant: 'b', successes: 0, failures: 0 },
    ]
    const a1 = thompsonAllocate(stats, { rng: seededRng(7) })
    const a2 = thompsonAllocate(stats, { rng: seededRng(7) })
    expect(a1).toEqual(a2) // seeded → reproducible
    expect(a1[0]!.share).toBeGreaterThan(0.4)
    expect(a1[0]!.share).toBeLessThan(0.6)
  })

  it('renders the allocation report', () => {
    const md = renderAllocationReport(
      'reactivation plays',
      thompsonAllocate([{ variant: 'timing', successes: 10, failures: 10 }], { rng: seededRng(1) }),
    )
    expect(md).toContain('Mix changes only')
    expect(md).toContain('| timing | 100% |')
  })

  it('keeps allocations normalized when the configured floor is impossible', () => {
    const stats = Array.from({ length: 25 }, (_, i) => ({ variant: `v${i}`, successes: 1, failures: 1 }))
    const allocations = thompsonAllocate(stats, { rng: seededRng(1), draws: 100 })
    expect(allocations.reduce((sum, item) => sum + item.share, 0)).toBeCloseTo(1, 6)
  })
})

describe('recalibrateIcp (speed 3b)', () => {
  const graded = (n: number, score: number, rate: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `${score}-${i}`, score, converted: i < n * rate }))

  it('computes per-band conversion and detects inversions', () => {
    const outcomes = [
      ...graded(40, 90, 0.05), // A converts at 5%
      ...graded(40, 70, 0.25), // B converts at 25% — inversion!
      ...graded(40, 50, 0.05),
    ]
    const result = recalibrateIcp(outcomes)
    expect(result.bands.find((b) => b.band === 'A')!.rate).toBeCloseTo(0.05)
    expect(result.bands.find((b) => b.band === 'B')!.rate).toBeCloseTo(0.25)
    expect(result.inversions).toContainEqual(
      expect.objectContaining({ higher: 'A', lower: 'B' }),
    )
    expect(result.proposals[0]).toContain('Band inversion')
    const md = renderCalibrationReport('Acme', '2026-07-09', result)
    expect(md).toContain('| A | 81-100 | 40 | 2 | 5% |')
  })

  it('stays silent on consistent scoring and thin samples', () => {
    const consistent = [...graded(40, 90, 0.3), ...graded(40, 70, 0.15), ...graded(40, 50, 0.05)]
    expect(recalibrateIcp(consistent).proposals).toEqual([])
    const thin = [...graded(5, 90, 0), ...graded(5, 70, 1)] // wild but tiny
    expect(recalibrateIcp(thin).inversions).toEqual([])
  })

  it('flags hard disqualifiers rejecting viable accounts (X converts like A)', () => {
    const outcomes = [...graded(30, 90, 0.2), ...graded(30, 10, 0.18)]
    const result = recalibrateIcp(outcomes)
    expect(result.proposals.some((p) => p.includes('auto-fail'))).toBe(true)
  })
})

describe('renderEngagementReport', () => {
  it('renders baseline→delta, trust trend, and delivery sections', () => {
    const events = [
      { kind: 'human_action' as const, id: 'e1', clientId: 'Acme', occurredAt: '2026-06-29T10:00:00Z', actor: 'g', action: 'grade_override' as const, machine: { skillId: 's@1', runId: 'r', itemRef: 'i', output: null }, surface: 'review_queue' as const },
      { kind: 'human_action' as const, id: 'e2', clientId: 'Acme', occurredAt: '2026-07-06T10:00:00Z', actor: 'g', action: 'approve' as const, machine: { skillId: 's@1', runId: 'r', itemRef: 'i', output: null }, surface: 'review_queue' as const },
    ]
    const md = renderEngagementReport({
      clientName: 'Acme',
      periodLabel: 'Weeks 1-2',
      baseline: { date: '2026-06-25', score: 61, accountDomainCoverage: 0.6, contactEmailCoverage: 0.7, duplicateDensity: 0.12 },
      current: { date: '2026-07-09', score: 84, accountDomainCoverage: 0.91, contactEmailCoverage: 0.93, duplicateDensity: 0.03 },
      feedbackEvents: events,
      runs: { totalRuns: 14, completed: 11, awaitingApproval: 2, failed: 1, clayCredits: 2140, tokensUsd: 18.4 },
    })
    expect(md).toContain('61/100 | 84/100 (+23)')
    expect(md).toContain('| Account domain coverage | 60% | 91% (+31pt) |')
    expect(md).toContain('| 2026-W27 | 1 | 0% |')
    expect(md).toContain('| 2026-W28 | 1 | 100% |')
    expect(md).toContain('2,140 Clay credits')
    expect(md).toContain('auditable end to end')
  })
})
