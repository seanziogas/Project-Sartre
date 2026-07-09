import { DEFAULT_MODULE_MVD } from './mvd.js'
import type { MetricKey, MvdRequirement } from './mvd.js'
import type { DataHealthReport } from './audit.js'

/**
 * Continuous quality monitoring (Layer 7, platform.quality): data contracts
 * on critical fields plus drift alerts when metrics decay between audit runs.
 * Standing client-visible value between campaign launches — the output feeds
 * digests and the ops-surface health page.
 */

const METRIC_ACCESSORS: Record<MetricKey, (r: DataHealthReport) => number> = {
  account_domain_coverage: (r) => r.identifierCoverage.accountDomain,
  account_linkedin_coverage: (r) => r.identifierCoverage.accountLinkedin,
  contact_email_coverage: (r) => r.identifierCoverage.contactEmail,
  contact_linkedin_coverage: (r) => r.identifierCoverage.contactLinkedin,
  account_dedup_cleanliness: (r) => 1 - r.duplicates.accountDensity,
  contact_dedup_cleanliness: (r) => 1 - r.duplicates.contactDensity,
  contact_linkage: (r) => (r.counts.contacts === 0 ? 1 : 1 - r.orphanContacts / r.counts.contacts),
  account_ownership: (r) => (r.counts.accounts === 0 ? 1 : 1 - r.ownership.accountsUnowned / r.counts.accounts),
}

export interface DataContract {
  metric: MetricKey
  min: number // 0..1
}

export interface ContractViolation {
  metric: MetricKey
  min: number
  actual: number
}

export function evaluateContracts(report: DataHealthReport, contracts: DataContract[]): ContractViolation[] {
  const violations: ContractViolation[] = []
  for (const contract of contracts) {
    const actual = METRIC_ACCESSORS[contract.metric](report)
    if (actual < contract.min) violations.push({ metric: contract.metric, min: contract.min, actual: round3(actual) })
  }
  return violations
}

/**
 * Derive default contracts from what the client's ENABLED modules require —
 * a module that passed its MVD gate at launch must not silently sink back
 * under it. Explicit per-client contracts extend/override these.
 */
export function contractsFromModules(enabledModuleIds: string[]): DataContract[] {
  const byMetric = new Map<MetricKey, number>()
  for (const moduleId of enabledModuleIds) {
    const reqs: MvdRequirement[] = DEFAULT_MODULE_MVD[moduleId] ?? []
    for (const req of reqs) {
      const existing = byMetric.get(req.metric)
      if (existing === undefined || req.required > existing) byMetric.set(req.metric, req.required)
    }
  }
  return [...byMetric].map(([metric, min]) => ({ metric, min }))
}

export interface DriftAlert {
  metric: MetricKey | 'health_score'
  before: number
  after: number
  delta: number
  severity: 'warning' | 'critical'
}

export interface DriftOptions {
  /** Metric drop (0..1 scale) that warns. Default 0.05. */
  warnDrop?: number
  /** Metric drop that's critical. Default 0.15. */
  criticalDrop?: number
  /** Health-score drop (0-100 scale) thresholds. Defaults 5 / 15. */
  scoreWarnDrop?: number
  scoreCriticalDrop?: number
}

/** Compare consecutive audit reports; decay beyond thresholds becomes alerts. */
export function detectDrift(previous: DataHealthReport, current: DataHealthReport, options: DriftOptions = {}): DriftAlert[] {
  const warnDrop = options.warnDrop ?? 0.05
  const criticalDrop = options.criticalDrop ?? 0.15
  const alerts: DriftAlert[] = []

  for (const metric of Object.keys(METRIC_ACCESSORS) as MetricKey[]) {
    const before = METRIC_ACCESSORS[metric](previous)
    const after = METRIC_ACCESSORS[metric](current)
    const drop = before - after
    if (drop >= criticalDrop) alerts.push({ metric, before: round3(before), after: round3(after), delta: round3(-drop), severity: 'critical' })
    else if (drop >= warnDrop) alerts.push({ metric, before: round3(before), after: round3(after), delta: round3(-drop), severity: 'warning' })
  }

  const scoreDrop = previous.score - current.score
  const scoreWarn = options.scoreWarnDrop ?? 5
  const scoreCritical = options.scoreCriticalDrop ?? 15
  if (scoreDrop >= scoreCritical) alerts.push({ metric: 'health_score', before: previous.score, after: current.score, delta: -scoreDrop, severity: 'critical' })
  else if (scoreDrop >= scoreWarn) alerts.push({ metric: 'health_score', before: previous.score, after: current.score, delta: -scoreDrop, severity: 'warning' })

  return alerts.sort((a, b) => (a.severity === b.severity ? a.delta - b.delta : a.severity === 'critical' ? -1 : 1))
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}
