import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { TenantId } from './governance.js'

export const ConfigStage = z.enum(['development', 'staging', 'production'])
export type ConfigStage = z.infer<typeof ConfigStage>

export const ConfigRelease = z.object({
  releaseId: z.string().uuid(), clientId: TenantId, version: z.number().int().positive(), digest: z.string().regex(/^[a-f0-9]{64}$/),
  files: z.record(z.string(), z.string()), stage: ConfigStage, status: z.enum(['active', 'pending_approval', 'rejected', 'superseded']),
  targetStage: ConfigStage.nullable(), createdBy: z.string().min(1), createdAt: z.string().datetime(),
  requestedBy: z.string().nullable(), requestedAt: z.string().datetime().nullable(), decidedBy: z.string().nullable(), decidedAt: z.string().datetime().nullable(),
})
export type ConfigRelease = z.infer<typeof ConfigRelease>

export function createConfigRelease(clientId: string, version: number, files: Record<string, string>, actor: string, at = new Date().toISOString()): ConfigRelease {
  if (!Object.keys(files).length) throw new Error('configuration release requires at least one file')
  return ConfigRelease.parse({
    releaseId: randomUUID(), clientId, version, digest: digestFiles(files), files, stage: 'development', status: 'active', targetStage: null,
    createdBy: actor, createdAt: at, requestedBy: null, requestedAt: null, decidedBy: null, decidedAt: null,
  })
}

export function requestPromotion(release: ConfigRelease, targetStage: ConfigStage, actor: string, at = new Date().toISOString()): ConfigRelease {
  const allowed = release.stage === 'development' ? 'staging' : release.stage === 'staging' ? 'production' : null
  if (release.status !== 'active' || targetStage !== allowed) throw new Error(`release cannot promote from ${release.stage} to ${targetStage}`)
  return ConfigRelease.parse({ ...release, status: 'pending_approval', targetStage, requestedBy: actor, requestedAt: at, decidedBy: null, decidedAt: null })
}

export function decidePromotion(release: ConfigRelease, decision: 'approved' | 'rejected', actor: string, at = new Date().toISOString()): ConfigRelease {
  if (release.status !== 'pending_approval' || !release.targetStage) throw new Error('release is not awaiting promotion approval')
  if (actor === release.requestedBy) throw new Error('configuration promotion requires separation of duties')
  return ConfigRelease.parse({
    ...release, stage: decision === 'approved' ? release.targetStage : release.stage, status: decision === 'approved' ? 'active' : 'rejected',
    targetStage: null, decidedBy: actor, decidedAt: at,
  })
}

export function digestFiles(files: Record<string, string>): string {
  const normalized = Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([path, content]) => `${path}\0${content.length}\0${content}`).join('\0')
  return createHash('sha256').update(normalized).digest('hex')
}
