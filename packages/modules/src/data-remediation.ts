import { partitionNamespacedWrites } from '@sartre/connectors'
import type { CrmWriter, NamespacedWrite, WriteReceipt } from '@sartre/connectors'
import { buildRemediationPlan, DEFAULT_MODULE_MVD } from '@sartre/data'
import type { DataHealthReport, RemediationPlan } from '@sartre/data'
import type { PipelineDefinition } from '@sartre/pipelines'
import { resolveClientDeps } from './client-deps.js'
import type { ClientDeps } from './client-deps.js'

/** Prepared values are drafts until the pipeline's structural human gate resolves. */
export interface PreparedRemediation {
  writes: NamespacedWrite[]
}

export interface RemediationDeps {
  loadHealthReport(clientId: string): Promise<DataHealthReport>
  /** Provider-backed work must stay within the plan credits reserved by the preceding step. */
  prepareWrites(clientId: string, plan: RemediationPlan): Promise<PreparedRemediation>
  crm: Pick<CrmWriter, 'snapshot' | 'writeNamespaced'>
}

interface PartitionedRemediation extends PreparedRemediation {
  allowed: NamespacedWrite[]
  rejected: { write: NamespacedWrite; reason: string }[]
}

/**
 * revops.remediation — price measured gaps → prepare namespaced drafts →
 * snapshot → HUMAN GATE → write. Bad data never blocks this module, while
 * malformed or non-namespaced writes fail before any CRM mutation.
 */
export function buildRemediationPipeline(source: ClientDeps<RemediationDeps>): PipelineDefinition {
  return {
    id: 'data-remediation@0.1.0',
    moduleId: 'revops.remediation',
    steps: [
      {
        id: 'plan',
        run: async (ctx) => {
          const report = await (await resolveClientDeps(source, ctx.clientId)).loadHealthReport(ctx.clientId)
          const configuredRequirements = Object.fromEntries(
            Object.keys(ctx.manifest.modules)
              .filter((moduleId) => moduleId !== 'revops.remediation' && moduleId in DEFAULT_MODULE_MVD)
              .map((moduleId) => [moduleId, DEFAULT_MODULE_MVD[moduleId]!]),
          )
          return buildRemediationPlan(report, configuredRequirements)
        },
      },
      {
        id: 'budget',
        run: async (ctx) => {
          const plan = ctx.outputs.plan as RemediationPlan
          ctx.spendCredits(plan.estimatedCredits, `reserved priced remediation work for ${plan.tasks.length} gaps`)
          return { reservedClayCredits: plan.estimatedCredits }
        },
      },
      {
        id: 'prepare',
        run: async (ctx) => {
          const deps = await resolveClientDeps(source, ctx.clientId)
          const plan = ctx.outputs.plan as RemediationPlan
          const prepared = await deps.prepareWrites(ctx.clientId, plan)
          const { allowed, rejected } = partitionNamespacedWrites(
            prepared.writes,
            ctx.manifest.policies.data.namespaced_field_prefix,
          )
          return { ...prepared, allowed, rejected } satisfies PartitionedRemediation
        },
      },
      {
        id: 'snapshot',
        run: async (ctx) => {
          const deps = await resolveClientDeps(source, ctx.clientId)
          const prepared = ctx.outputs.prepare as PartitionedRemediation
          if (prepared.rejected.length > 0) {
            throw new Error(`remediation draft contains ${prepared.rejected.length} non-namespaced CRM write(s)`)
          }
          return prepared.allowed.length === 0 ? null : deps.crm.snapshot(prepared.allowed)
        },
      },
      {
        id: 'review',
        run: async (ctx) => {
          const plan = ctx.outputs.plan as RemediationPlan
          const prepared = ctx.outputs.prepare as PartitionedRemediation
          const snapshotRef = ctx.outputs.snapshot as string | null
          if (plan.tasks.length === 0 && prepared.allowed.length === 0) return { action: 'none' }
          const payload = { plan, writes: prepared.allowed, snapshotRef }
          await ctx.gate(prepared.allowed.length === 0 ? 'internal_report' : 'crm_write', payload)
          return payload
        },
      },
      {
        id: 'write',
        effect: true,
        run: async (ctx) => {
          const deps = await resolveClientDeps(source, ctx.clientId)
          const prepared = ctx.outputs.prepare as PartitionedRemediation
          const snapshotRef = ctx.outputs.snapshot as string | null
          if (prepared.allowed.length === 0) {
            return { written: 0, rejected: [], snapshotRef: null }
          }
          if (!snapshotRef) throw new Error('remediation CRM write requires a source snapshot')
          return deps.crm.writeNamespaced(prepared.allowed, snapshotRef) as Promise<WriteReceipt>
        },
      },
    ],
  }
}
