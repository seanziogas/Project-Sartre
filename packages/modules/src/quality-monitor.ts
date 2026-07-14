import {
  contractsFromModules,
  detectDrift,
  evaluateContracts,
  evaluateMvd,
  DEFAULT_MODULE_MVD,
} from '@sartre/data'
import type { DataHealthReport } from '@sartre/data'
import type { MvdStatus } from '@sartre/core'
import type { PipelineDefinition } from '@sartre/pipelines'
import { resolveClientDeps } from './client-deps.js'
import type { ClientDeps } from './client-deps.js'

export interface QualityMonitorDeps {
  loadReports(clientId: string): Promise<{ current: DataHealthReport; previous: DataHealthReport | null }>
  saveMvd(clientId: string, mvd: Record<string, MvdStatus>): Promise<void>
  notify(clientId: string, subject: string, body: string): Promise<void>
}

interface QualityAlert {
  subject: string
  body: string
  report: {
    score: number
    violations: ReturnType<typeof evaluateContracts>
    drift: ReturnType<typeof detectDrift>
  }
}

/** platform.quality — scheduled contracts/MVD refresh → HUMAN CLIENT-COMMS GATE → alert. */
export function buildQualityMonitorPipeline(source: ClientDeps<QualityMonitorDeps>): PipelineDefinition {
  return {
    id: 'quality-monitor@0.1.0',
    moduleId: 'platform.quality',
    steps: [
      {
        id: 'load',
        run: async (ctx) => (await resolveClientDeps(source, ctx.clientId)).loadReports(ctx.clientId),
      },
      {
        id: 'mvd-refresh',
        run: async (ctx) => {
          const deps = await resolveClientDeps(source, ctx.clientId)
          const { current } = ctx.outputs.load as Awaited<ReturnType<QualityMonitorDeps['loadReports']>>
          const mvd: Record<string, MvdStatus> = {}
          for (const [moduleId, requirements] of Object.entries(DEFAULT_MODULE_MVD)) {
            mvd[moduleId] = evaluateMvd(current, requirements)
          }
          await deps.saveMvd(ctx.clientId, mvd)
          return mvd
        },
      },
      {
        id: 'evaluate',
        run: async (ctx) => {
          const { current, previous } = ctx.outputs.load as Awaited<ReturnType<QualityMonitorDeps['loadReports']>>
          const enabled = Object.entries(ctx.manifest.modules)
            .filter(([, config]) => config.enabled)
            .map(([moduleId]) => moduleId)
          const violations = evaluateContracts(current, contractsFromModules(enabled))
          const drift = previous ? detectDrift(previous, current) : []
          if (violations.length === 0 && drift.length === 0) return null
          const body = [
            `Data health: ${current.score}/100.`,
            ...violations.map((item) => `CONTRACT: ${item.metric} at ${Math.round(item.actual * 100)}% (floor ${Math.round(item.min * 100)}%)`),
            ...drift.map((item) => `DRIFT [${item.severity}]: ${item.metric} ${item.before} → ${item.after}`),
          ].join('\n')
          return { subject: 'Data health alert', body, report: { score: current.score, violations, drift } } satisfies QualityAlert
        },
      },
      {
        id: 'review',
        run: async (ctx) => {
          const alert = ctx.outputs.evaluate as QualityAlert | null
          if (alert) await ctx.gate('client_comms', alert)
          return alert
        },
      },
      {
        id: 'notify',
        effect: true,
        run: async (ctx) => {
          const deps = await resolveClientDeps(source, ctx.clientId)
          const alert = ctx.outputs.evaluate as QualityAlert | null
          if (!alert) return { notified: false }
          await deps.notify(ctx.clientId, alert.subject, alert.body)
          return { notified: true }
        },
      },
    ],
  }
}
