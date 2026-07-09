import type { HumanActionEvent } from '@sartre/core'

/**
 * Metrics as product (Layer 8): override rate, edit distance proxy, and
 * approve-without-edit rate, tracked first-class. Declining human correction
 * over time is both proof the learning works and the QBR slide that renews
 * the contract.
 */

export interface ReviewMetrics {
  events: number
  approveRate: number // approve (no edit) / all decisions
  approveWithEditRate: number
  rejectRate: number
  overrideRate: number // grade/routing/play corrections / all decisions
  byPipeline: Record<string, { events: number; approveRate: number }>
}

const DECISIVE: HumanActionEvent['action'][] = [
  'approve',
  'approve_with_edit',
  'reject',
  'grade_override',
  'routing_correction',
  'play_reassignment',
  'list_removal',
]

export function computeReviewMetrics(events: HumanActionEvent[]): ReviewMetrics {
  const decisions = events.filter((e) => DECISIVE.includes(e.action))
  const n = decisions.length
  const count = (pred: (e: HumanActionEvent) => boolean) => decisions.filter(pred).length
  const rate = (x: number) => (n === 0 ? 0 : x / n)

  const byPipeline: ReviewMetrics['byPipeline'] = {}
  for (const [pipeline, group] of groupBy(decisions, (e) => e.machine.skillId)) {
    byPipeline[pipeline] = {
      events: group.length,
      approveRate: group.length === 0 ? 0 : group.filter((e) => e.action === 'approve').length / group.length,
    }
  }

  return {
    events: n,
    approveRate: rate(count((e) => e.action === 'approve')),
    approveWithEditRate: rate(count((e) => e.action === 'approve_with_edit')),
    rejectRate: rate(count((e) => e.action === 'reject')),
    overrideRate: rate(
      count((e) => ['grade_override', 'routing_correction', 'play_reassignment', 'list_removal'].includes(e.action)),
    ),
    byPipeline,
  }
}

/**
 * The renewal chart: metrics per period (e.g. ISO week), so "human correction
 * declining over time" is a computed series, not an anecdote.
 */
export function metricsByPeriod(
  events: HumanActionEvent[],
  periodOf: (iso: string) => string = isoWeek,
): { period: string; metrics: ReviewMetrics }[] {
  return [...groupBy(events, (e) => periodOf(e.occurredAt))]
    .map(([period, group]) => ({ period, metrics: computeReviewMetrics(group) }))
    .sort((a, b) => a.period.localeCompare(b.period))
}

export function isoWeek(iso: string): string {
  const d = new Date(iso)
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dayNum = (target.getUTCDay() + 6) % 7
  target.setUTCDate(target.getUTCDate() - dayNum + 3)
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4))
  const week = 1 + Math.round(((target.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7)
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const key = keyOf(item)
    const list = map.get(key)
    if (list) list.push(item)
    else map.set(key, [item])
  }
  return map
}
