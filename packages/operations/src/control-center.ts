import { z } from 'zod'
import { TenantId } from './governance.js'

export const EvaluationRun = z.object({
  evaluationId: z.string().uuid(), clientId: TenantId, skillId: z.string().min(1), version: z.string().min(1),
  status: z.enum(['passed', 'failed']), passed: z.number().int().nonnegative(), failed: z.number().int().nonnegative(),
  detail: z.string(), source: z.enum(['ci', 'live', 'learning']), createdAt: z.string().datetime(),
})
export type EvaluationRun = z.infer<typeof EvaluationRun>

export interface LearningControlCenter {
  evaluations: EvaluationRun[]
  totals: { evaluations: number; passed: number; failed: number; regressions: number }
  proposals: Array<{ key: string; kind: string; status: string; createdAt: string | null }>
}

export function buildLearningControlCenter(evaluations: EvaluationRun[], artifacts: Array<{ key: string; value: unknown; updatedAt: string }>): LearningControlCenter {
  const ordered = [...evaluations].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return {
    evaluations: ordered,
    totals: {
      evaluations: ordered.length,
      passed: ordered.reduce((sum, item) => sum + item.passed, 0),
      failed: ordered.reduce((sum, item) => sum + item.failed, 0),
      regressions: ordered.filter((item) => item.status === 'failed').length,
    },
    proposals: artifacts.filter((item) => item.key.startsWith('learning:')).map((item) => {
      const value = item.value && typeof item.value === 'object' ? item.value as Record<string, unknown> : {}
      return {
        key: item.key,
        kind: typeof value.kind === 'string' ? value.kind : 'proposal',
        status: typeof value.status === 'string' ? value.status : 'draft',
        createdAt: typeof value.createdAt === 'string' ? value.createdAt : item.updatedAt,
      }
    }).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')),
  }
}
