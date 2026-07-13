import type { MvdStatus } from '@sartre/core'
import type { DataHealthReport } from './audit.js'

/**
 * Minimum Viable Data gates (Layer 7). Every module declares required
 * coverage; the audit report is evaluated against those declarations and the
 * result is written into the manifest's `mvd` block. Green = all requirements
 * met; yellow = within tolerance of at least one requirement; red = hard
 * blocked. The remediation pipeline prices the gaps.
 */

export interface MvdRequirement {
  /** Metric key into the audit report (see METRIC_ACCESSORS). */
  metric: MetricKey
  /** Minimum acceptable value, 0..1. */
  required: number
  /** Within this much below `required` still rates yellow instead of red. Default 0.1. */
  tolerance?: number
  /** Estimated Clay credits per missing record to close the gap, if enrichable. */
  remediationCreditsPerRecord?: number
}

export interface RemediationTask {
  metric: MetricKey
  object: 'account' | 'contact'
  currentCoverage: number
  targetCoverage: number
  affectedRecords: number | null
  estimatedCredits: number | null
  blockedModules: string[]
}

export interface RemediationPlan {
  generatedAt: string
  healthScore: number
  tasks: RemediationTask[]
  estimatedCredits: number
  manualScopeTasks: number
}

export type MetricKey =
  | 'account_domain_coverage'
  | 'account_linkedin_coverage'
  | 'contact_email_coverage'
  | 'contact_linkedin_coverage'
  | 'account_dedup_cleanliness'
  | 'contact_dedup_cleanliness'
  | 'contact_linkage'
  | 'account_ownership'

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

/**
 * Default MVD declarations per canonical module (docs/taxonomy.md ids).
 * Thresholds start from the proven standards (e.g. "95% email coverage good,
 * 60% possibly unacceptable" — TOS build standards) and are per-client
 * tunable via module thresholds later.
 */
export const DEFAULT_MODULE_MVD: Record<string, MvdRequirement[]> = {
  'revops.enrichment': [
    { metric: 'account_domain_coverage', required: 0.7, remediationCreditsPerRecord: 2 },
  ],
  'revops.dedup': [
    { metric: 'account_domain_coverage', required: 0.6, remediationCreditsPerRecord: 2 },
  ],
  'revops.tam': [
    { metric: 'account_domain_coverage', required: 0.8, remediationCreditsPerRecord: 2 },
    { metric: 'account_dedup_cleanliness', required: 0.85 },
  ],
  'revops.routing': [
    { metric: 'account_ownership', required: 0.8 },
    { metric: 'account_domain_coverage', required: 0.7, remediationCreditsPerRecord: 2 },
  ],
  'revops.lead-convert': [
    { metric: 'account_domain_coverage', required: 0.7, remediationCreditsPerRecord: 2 },
    { metric: 'contact_email_coverage', required: 0.8, remediationCreditsPerRecord: 3 },
  ],
  'sales.outbound': [
    { metric: 'contact_email_coverage', required: 0.9, tolerance: 0.15, remediationCreditsPerRecord: 3 },
    { metric: 'account_dedup_cleanliness', required: 0.9 }, // existing customers/opps must be excludable
  ],
  'sales.reactivation': [
    { metric: 'contact_email_coverage', required: 0.8, remediationCreditsPerRecord: 3 },
  ],
  'sales.abm': [
    { metric: 'account_domain_coverage', required: 0.8, remediationCreditsPerRecord: 2 },
    { metric: 'account_dedup_cleanliness', required: 0.9 },
  ],
  'sales.takeout': [
    { metric: 'account_domain_coverage', required: 0.8, remediationCreditsPerRecord: 2 },
    { metric: 'contact_email_coverage', required: 0.8, remediationCreditsPerRecord: 3 },
  ],
  'sales.rep-workflows': [
    { metric: 'contact_linkage', required: 0.8 },
    { metric: 'account_ownership', required: 0.8 },
  ],
  'marketing.inbound': [
    { metric: 'contact_linkage', required: 0.7 },
    { metric: 'account_domain_coverage', required: 0.7, remediationCreditsPerRecord: 2 },
  ],
  'marketing.deanon': [
    { metric: 'account_domain_coverage', required: 0.7, remediationCreditsPerRecord: 2 },
    { metric: 'account_dedup_cleanliness', required: 0.85 },
  ],
  'marketing.events': [
    { metric: 'contact_email_coverage', required: 0.8, remediationCreditsPerRecord: 3 },
  ],
  'marketing.copy-factory': [],
  'marketing.ads-sync': [
    { metric: 'account_domain_coverage', required: 0.8, remediationCreditsPerRecord: 2 },
    { metric: 'contact_email_coverage', required: 0.8, remediationCreditsPerRecord: 3 },
  ],
  'sales.copilot-briefs': [
    { metric: 'account_domain_coverage', required: 0.6, remediationCreditsPerRecord: 2 },
  ],
  'revops.etl': [],
  // platform.* modules run on whatever exists — that's their job.
  'platform.signals': [],
  'platform.quality': [],
  'platform.digests': [],
  'platform.learning': [],
  'platform.metrics': [],
  'revops.remediation': [], // remediation is never blocked by bad data — it IS the fix
}

export function evaluateMvd(
  report: DataHealthReport,
  requirements: MvdRequirement[],
  asOf?: string,
): MvdStatus {
  const date = asOf ?? report.generatedAt.slice(0, 10)
  if (requirements.length === 0) return { status: 'green', as_of: date, blocking_gaps: [] }

  let worst: 'green' | 'yellow' | 'red' = 'green'
  const gaps: MvdStatus['blocking_gaps'] = []
  for (const req of requirements) {
    const value = METRIC_ACCESSORS[req.metric](report)
    if (value >= req.required) continue
    const tolerance = req.tolerance ?? 0.1
    const level = value >= req.required - tolerance ? 'yellow' : 'red'
    if (level === 'red' || worst === 'green') worst = level
    const missingRecords = estimateMissingRecords(report, req.metric, req.required)
    gaps.push({
      field: req.metric,
      coverage: round2(value),
      required: req.required,
      remediation_credits:
        req.remediationCreditsPerRecord !== undefined && missingRecords !== null
          ? Math.ceil(missingRecords * req.remediationCreditsPerRecord)
          : null,
    })
  }
  return { status: worst, as_of: date, blocking_gaps: gaps }
}

/** Collapse overlapping module gaps into one priced remediation work plan. */
export function buildRemediationPlan(
  report: DataHealthReport,
  requirementsByModule: Record<string, MvdRequirement[]> = DEFAULT_MODULE_MVD,
): RemediationPlan {
  const tasks = new Map<MetricKey, RemediationTask>()
  for (const [moduleId, requirements] of Object.entries(requirementsByModule)) {
    for (const requirement of requirements) {
      const coverage = METRIC_ACCESSORS[requirement.metric](report)
      if (coverage >= requirement.required) continue
      const existing = tasks.get(requirement.metric)
      if (existing) {
        if (!existing.blockedModules.includes(moduleId)) existing.blockedModules.push(moduleId)
        if (requirement.required <= existing.targetCoverage) continue
      }
      const affectedRecords = estimateMissingRecords(report, requirement.metric, requirement.required)
      tasks.set(requirement.metric, {
        metric: requirement.metric,
        object: requirement.metric.startsWith('account') ? 'account' : 'contact',
        currentCoverage: round2(coverage),
        targetCoverage: requirement.required,
        affectedRecords,
        estimatedCredits: requirement.remediationCreditsPerRecord !== undefined && affectedRecords !== null
          ? Math.ceil(affectedRecords * requirement.remediationCreditsPerRecord)
          : null,
        blockedModules: existing?.blockedModules ?? [moduleId],
      })
    }
  }
  const ordered = [...tasks.values()].sort((a, b) => a.metric.localeCompare(b.metric))
  return {
    generatedAt: report.generatedAt,
    healthScore: report.score,
    tasks: ordered,
    estimatedCredits: ordered.reduce((total, task) => total + (task.estimatedCredits ?? 0), 0),
    manualScopeTasks: ordered.filter((task) => task.estimatedCredits === null).length,
  }
}

function estimateMissingRecords(report: DataHealthReport, metric: MetricKey, required: number): number | null {
  const value = METRIC_ACCESSORS[metric](report)
  const base = metric.startsWith('account') ? report.counts.accounts : report.counts.contacts
  if (base === 0) return null
  return Math.max(0, Math.ceil((required - value) * base))
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
