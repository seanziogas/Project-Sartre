import { computeReviewMetrics, metricsByPeriod } from './metrics.js'
import type { HumanActionEvent } from '@sartre/core'

/**
 * Baseline → delta engagement report (Layer 5's renewal artifact, PLAN §9):
 * what the data looked like when we arrived, what it looks like now, how much
 * the humans have to correct the machine, and what it cost. Auto-generated
 * per engagement — the QBR starts from this, not from anecdotes.
 */

export interface HealthSnapshot {
  date: string
  score: number
  accountDomainCoverage: number
  contactEmailCoverage: number
  duplicateDensity: number
}

export interface RunsSummary {
  totalRuns: number
  completed: number
  awaitingApproval: number
  failed: number
  clayCredits: number
  tokensUsd: number
}

export interface EngagementReportInput {
  clientName: string
  periodLabel: string // e.g. "2026 Q3" or "Weeks 1-6"
  baseline: HealthSnapshot
  current: HealthSnapshot
  feedbackEvents: HumanActionEvent[]
  runs: RunsSummary
}

export function renderEngagementReport(input: EngagementReportInput): string {
  const { baseline, current } = input
  const overall = computeReviewMetrics(input.feedbackEvents)
  const series = metricsByPeriod(input.feedbackEvents)
  const delta = (b: number, c: number, asPct = true) => {
    const d = c - b
    const fmt = asPct ? (n: number) => `${Math.round(n * 100)}%` : (n: number) => `${n}`
    return `${fmt(b)} → ${fmt(c)} (${d >= 0 ? '+' : ''}${asPct ? Math.round(d * 100) : d}${asPct ? 'pt' : ''})`
  }

  return [
    `# Engagement Report — ${input.clientName} (${input.periodLabel})`,
    '',
    '## Data health: baseline → now',
    '',
    `| metric | ${baseline.date} | ${current.date} |`,
    '|---|---|---|',
    `| Health score | ${baseline.score}/100 | ${current.score}/100 (${current.score - baseline.score >= 0 ? '+' : ''}${current.score - baseline.score}) |`,
    `| Account domain coverage | ${delta(baseline.accountDomainCoverage, current.accountDomainCoverage)} |`.replace('| Account', '| Account').replace(' |', ' |'),
    `| Contact email coverage | ${delta(baseline.contactEmailCoverage, current.contactEmailCoverage)} |`,
    `| Duplicate density | ${delta(baseline.duplicateDensity, current.duplicateDensity)} |`,
    '',
    '## The machine is earning trust',
    '',
    `${overall.events} human review decisions this period: **${Math.round(overall.approveRate * 100)}% approved without edit**, ${Math.round(overall.approveWithEditRate * 100)}% approved with edits, ${Math.round(overall.overrideRate * 100)}% overridden.`,
    '',
    series.length > 1
      ? ['| week | decisions | approve-without-edit |', '|---|---|---|', ...series.map((s) => `| ${s.period} | ${s.metrics.events} | ${Math.round(s.metrics.approveRate * 100)}% |`)].join('\n')
      : '_One period of data so far — the trend chart starts next week._',
    '',
    '## Delivery',
    '',
    `${input.runs.totalRuns} pipeline runs: ${input.runs.completed} completed, ${input.runs.awaitingApproval} in review, ${input.runs.failed} failed. Spend: ${input.runs.clayCredits.toLocaleString()} Clay credits, $${input.runs.tokensUsd.toFixed(2)} model tokens.`,
    '',
    '_Every number above is computed from the run journal and feedback log — auditable end to end._',
    '',
  ].join('\n')
}
