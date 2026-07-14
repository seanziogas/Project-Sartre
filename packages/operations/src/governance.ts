import { z } from 'zod'

export const TenantId = z.string().trim().min(1).refine((value) => !value.includes('/') && !value.includes('\\') && value !== '.' && value !== '..', 'unsafe tenant id')

export const DataCategory = z.enum(['runs', 'feedback', 'connections', 'staging', 'canonical', 'artifacts', 'effects', 'configuration', 'evaluations', 'audit', 'brain'])
export type DataCategory = z.infer<typeof DataCategory>

export const GovernancePolicy = z.object({
  clientId: TenantId,
  retentionDays: z.record(DataCategory, z.number().int().min(1).max(3_650)),
  residency: z.string().min(2),
  exportEnabled: z.boolean(),
  deletionGraceDays: z.number().int().min(1).max(90),
  updatedAt: z.string().datetime(),
  updatedBy: z.string().min(1),
})
export type GovernancePolicy = z.infer<typeof GovernancePolicy>

export const GovernanceRequest = z.object({
  requestId: z.string().uuid(), clientId: TenantId, kind: z.enum(['export', 'restore', 'deletion', 'retention']),
  status: z.enum(['pending', 'approved', 'rejected', 'executed']),
  scope: z.array(DataCategory).min(1), reason: z.string().min(1), requestedBy: z.string().min(1), requestedAt: z.string().datetime(),
  decidedBy: z.string().nullable(), decidedAt: z.string().datetime().nullable(), executedBy: z.string().nullable(), executedAt: z.string().datetime().nullable(),
})
export type GovernanceRequest = z.infer<typeof GovernanceRequest>

export function decideGovernanceRequest(request: GovernanceRequest, decision: 'approved' | 'rejected', actor: string, at: string): GovernanceRequest {
  if (request.status !== 'pending') throw new Error(`governance request is already ${request.status}`)
  if (!actor.trim()) throw new Error('governance decision actor is required')
  if (request.kind === 'deletion' && actor === request.requestedBy) throw new Error('deletion requires separation of duties')
  return GovernanceRequest.parse({ ...request, status: decision, decidedBy: actor, decidedAt: at })
}

export function executeGovernanceRequest(request: GovernanceRequest, actor: string, at: string): GovernanceRequest {
  if (request.status !== 'approved') throw new Error('only an approved governance request can execute')
  if (!actor.trim()) throw new Error('governance executor is required')
  return GovernanceRequest.parse({ ...request, status: 'executed', executedBy: actor, executedAt: at })
}

export function retentionCutoffs(policy: GovernancePolicy, now = new Date()): Record<DataCategory, string> {
  return Object.fromEntries(Object.entries(policy.retentionDays).map(([category, days]) => [category, new Date(now.getTime() - days * 86_400_000).toISOString()])) as Record<DataCategory, string>
}
