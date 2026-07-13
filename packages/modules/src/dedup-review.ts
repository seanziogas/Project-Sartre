import { partitionNamespacedWrites } from '@sartre/connectors'
import type { CrmWriter, NamespacedWrite, WriteReceipt } from '@sartre/connectors'
import type { DuplicateReviewGroup } from '@sartre/data'
import type { PipelineDefinition } from '@sartre/pipelines'
import { resolveClientDeps } from './client-deps.js'
import type { ClientDeps } from './client-deps.js'

export interface DedupReviewDeps {
  loadDuplicateGroups(clientId: string): Promise<DuplicateReviewGroup[]>
  /** Builds namespaced annotations only; this contract has no merge or delete operation. */
  prepareAnnotationWrites(clientId: string, groups: DuplicateReviewGroup[]): Promise<NamespacedWrite[]>
  crm: Pick<CrmWriter, 'snapshot' | 'writeNamespaced'>
}

interface PreparedDedupReview {
  writes: NamespacedWrite[]
}

/** revops.dedup — flag/review/write annotations; canonical and CRM records are never merged or deleted. */
export function buildDedupReviewPipeline(source: ClientDeps<DedupReviewDeps>): PipelineDefinition {
  return {
    id: 'dedup-review@0.1.0',
    moduleId: 'revops.dedup',
    steps: [
      {
        id: 'load',
        run: async (ctx) => (await resolveClientDeps(source, ctx.clientId)).loadDuplicateGroups(ctx.clientId),
      },
      {
        id: 'prepare',
        run: async (ctx) => {
          const deps = await resolveClientDeps(source, ctx.clientId)
          const groups = ctx.outputs.load as DuplicateReviewGroup[]
          const writes = await deps.prepareAnnotationWrites(ctx.clientId, groups)
          assertWritesTargetGroups(writes, groups)
          const { allowed, rejected } = partitionNamespacedWrites(
            writes,
            ctx.manifest.policies.data.namespaced_field_prefix,
          )
          if (rejected.length > 0) {
            throw new Error(`dedup annotations contain ${rejected.length} non-namespaced CRM write(s)`)
          }
          return { writes: allowed } satisfies PreparedDedupReview
        },
      },
      {
        id: 'snapshot',
        run: async (ctx) => {
          const deps = await resolveClientDeps(source, ctx.clientId)
          const { writes } = ctx.outputs.prepare as PreparedDedupReview
          return writes.length === 0 ? null : deps.crm.snapshot(writes)
        },
      },
      {
        id: 'review',
        run: async (ctx) => {
          const groups = ctx.outputs.load as DuplicateReviewGroup[]
          const { writes } = ctx.outputs.prepare as PreparedDedupReview
          const snapshotRef = ctx.outputs.snapshot as string | null
          if (groups.length === 0 && writes.length === 0) return { action: 'none' }
          const payload = { groups, writes, snapshotRef, destructiveActions: false }
          await ctx.gate(writes.length === 0 ? 'internal_report' : 'crm_write', payload)
          return payload
        },
      },
      {
        id: 'write',
        run: async (ctx) => {
          const deps = await resolveClientDeps(source, ctx.clientId)
          const { writes } = ctx.outputs.prepare as PreparedDedupReview
          const snapshotRef = ctx.outputs.snapshot as string | null
          if (writes.length === 0) return { written: 0, rejected: [], snapshotRef: null }
          if (!snapshotRef) throw new Error('dedup CRM write requires a source snapshot')
          return deps.crm.writeNamespaced(writes, snapshotRef) as Promise<WriteReceipt>
        },
      },
    ],
  }
}

function assertWritesTargetGroups(writes: NamespacedWrite[], groups: DuplicateReviewGroup[]): void {
  const allowed = new Set<string>()
  for (const group of groups) {
    for (const member of group.members) {
      for (const externalId of Object.values(member.externalIds)) {
        allowed.add(`${group.recordType}:${externalId}`)
      }
    }
  }
  for (const write of writes) {
    if (write.object === 'opportunity' || !allowed.has(`${write.object}:${write.externalId}`)) {
      throw new Error(`dedup annotation targets record outside the review groups: ${write.object}:${write.externalId}`)
    }
    if (Object.keys(write.fields).length === 0) throw new Error('dedup annotation must contain at least one field')
  }
}
