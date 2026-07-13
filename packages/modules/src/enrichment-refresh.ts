import {
  contractsFromModules,
  detectDrift,
  evaluateContracts,
  evaluateMvd,
  runDataAudit,
  DEFAULT_MODULE_MVD,
} from '@sartre/data'
import type { AuditAccountRow, AuditContactRow, DataHealthReport } from '@sartre/data'
import type { MvdStatus } from '@sartre/core'
import type { PipelineDefinition } from '@sartre/pipelines'

/**
 * revops.enrichment — scheduled hygiene/audit refresh (always-on mode).
 * Pull → audit → refresh MVD statuses → contracts + drift check → notify.
 * This is also the Day-1 Data Audit pipeline: on a fresh instance the same
 * run produces the first health report and the initial MVD block.
 */

export interface EnrichmentRefreshDeps {
  /** Adapted from the CRM connector's staged rows (mock or live). */
  pullAccounts(): Promise<AuditAccountRow[]>
  pullContacts(): Promise<AuditContactRow[]>
  loadPreviousReport(clientId: string): Promise<DataHealthReport | null>
  saveReport(clientId: string, report: DataHealthReport): Promise<void>
  /** Written into the manifest's mvd block (machine-owned). */
  saveMvd(clientId: string, mvd: Record<string, MvdStatus>): Promise<void>
  /** Delivery channel (Slack/Teams/email per manifest). */
  notify(clientId: string, subject: string, body: string): Promise<void>
  now?: () => Date
}

export function buildEnrichmentRefreshPipeline(deps: EnrichmentRefreshDeps): PipelineDefinition {
  return {
    id: 'enrichment-refresh@0.1.0',
    moduleId: 'revops.enrichment',
    preflight: 'data_audit',
    steps: [
      {
        id: 'previous-report',
        run: async (ctx) => deps.loadPreviousReport(ctx.clientId),
      },
      {
        id: 'pull',
        run: async () => {
          const [accounts, contacts] = await Promise.all([deps.pullAccounts(), deps.pullContacts()])
          return { accounts, contacts }
        },
      },
      {
        id: 'audit',
        run: async (ctx) => {
          const { accounts, contacts } = ctx.outputs.pull as {
            accounts: AuditAccountRow[]
            contacts: AuditContactRow[]
          }
          const report = runDataAudit(accounts, contacts, deps.now ? { now: deps.now() } : {})
          await deps.saveReport(ctx.clientId, report)
          return report
        },
      },
      {
        id: 'mvd-refresh',
        run: async (ctx) => {
          const report = ctx.outputs.audit as DataHealthReport
          const mvd: Record<string, MvdStatus> = {}
          for (const [moduleId, requirements] of Object.entries(DEFAULT_MODULE_MVD)) {
            mvd[moduleId] = evaluateMvd(report, requirements)
          }
          await deps.saveMvd(ctx.clientId, mvd)
          return mvd
        },
      },
      {
        id: 'monitor',
        run: async (ctx) => {
          const report = ctx.outputs.audit as DataHealthReport
          const enabled = Object.entries(ctx.manifest.modules)
            .filter(([, m]) => m.enabled)
            .map(([id]) => id)
          const violations = evaluateContracts(report, contractsFromModules(enabled))
          const previous = ctx.outputs['previous-report'] as DataHealthReport | null
          const drift = previous ? detectDrift(previous, report) : []

          const result = { violations, drift, score: report.score }
          if (violations.length > 0 || drift.length > 0) {
            const lines = [
              `Data health: ${report.score}/100.`,
              ...violations.map((v) => `CONTRACT: ${v.metric} at ${Math.round(v.actual * 100)}% (floor ${Math.round(v.min * 100)}%)`),
              ...drift.map((d) => `DRIFT [${d.severity}]: ${d.metric} ${d.before} → ${d.after}`),
            ]
            const subject = 'Data health alert'
            const body = lines.join('\n')
            await ctx.gate('client_comms', { subject, body, report: result })
            await deps.notify(ctx.clientId, subject, body)
          }
          return result
        },
      },
    ],
  }
}
