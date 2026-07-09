import { z } from 'zod'
import { parse as parseYaml } from 'yaml'

/**
 * Client manifest (client.yaml) — zod mirror of schemas/client-manifest.schema.json.
 * The JSON Schema is the documented contract; this is the runtime validator.
 * Keep the two in sync (a test loads clients/_template/client.yaml through this).
 */

export const MODULE_ID_PATTERN = /^(sales|marketing|revops|platform)\.[a-z-]+$/

export const ModuleId = z.string().regex(MODULE_ID_PATTERN, 'module ids look like revops.enrichment (see docs/taxonomy.md)')
export type ModuleId = z.infer<typeof ModuleId>

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
/** The template ships placeholder dates; validation accepts them only in template mode. */
const isoDateOrPlaceholder = z.union([isoDate, z.literal('YYYY-MM-DD')])

export const ModuleConfig = z.object({
  enabled: z.boolean(),
  always_on: z.boolean().default(false),
  schedule: z.string().optional(),
  thresholds: z.record(z.string(), z.unknown()).default({}),
  override_mvd: z
    .object({ reason: z.string().min(1), approved_by: z.string().min(1) })
    .optional(),
})
export type ModuleConfig = z.infer<typeof ModuleConfig>

export const ApprovalPolicy = z.enum(['block', 'notify', 'auto'])

export const MvdGap = z.object({
  field: z.string(),
  coverage: z.number(),
  required: z.number(),
  remediation_credits: z.number().int().nullable().default(null),
})

export const MvdStatus = z.object({
  status: z.enum(['green', 'yellow', 'red', 'unknown']),
  as_of: isoDate,
  blocking_gaps: z.array(MvdGap).default([]),
})
export type MvdStatus = z.infer<typeof MvdStatus>

export const ClientManifest = z.object({
  client: z.object({
    name: z.string().min(1),
    engagement_start: isoDateOrPlaceholder,
    engagement_end: isoDate.nullable().default(null),
    pod: z
      .object({ md: z.string().default(''), gtme: z.string().default(''), tos: z.string().default('') })
      .default({ md: '', gtme: '', tos: '' }),
  }),
  status: z.enum(['onboarding', 'active', 'paused', 'archived']),
  stack: z.object({
    crm: z.enum(['salesforce', 'hubspot', 'attio']).nullable().default(null),
    enrichment: z.array(z.string()).default([]),
    sequencers: z.array(z.string()).default([]),
    comms: z.array(z.enum(['slack', 'teams', 'email'])).default([]),
    meetings: z.array(z.string()).default([]),
    intent: z.array(z.string()).default([]),
    warehouse: z.array(z.string()).default([]),
    inbound: z.array(z.string()).default([]),
  }),
  modules: z.record(ModuleId, ModuleConfig).default({}),
  policies: z.object({
    approval: z.record(
      z.enum(['outbound_send', 'crm_write', 'client_comms', 'brain_change', 'internal_report']),
      ApprovalPolicy,
    ),
    learning: z
      .object({
        capture: z.boolean().default(true),
        exemplar_memory: z.boolean().default(true),
        weekly_tuning: z.boolean().default(false),
        outcome_optimization: z.boolean().default(false),
      })
      .default({}),
    data: z
      .object({
        flag_dont_delete: z.literal(true).default(true),
        snapshot_before_write: z.literal(true).default(true),
        reenrichment_window_days: z.number().int().positive().default(90),
        namespaced_field_prefix: z.string().default('Kiln_'),
      })
      .default({}),
  }),
  delivery: z.object({
    channels: z
      .array(
        z.object({
          type: z.enum(['slack', 'teams', 'email', 'notion', 'crm']),
          target: z.string().default(''),
          outputs: z.array(z.string()).default([]),
        }),
      )
      .default([]),
  }),
  budgets: z
    .object({
      clay_credits_monthly: z.number().int().nullable().default(null),
      token_budget_monthly_usd: z.number().nullable().default(null),
      per_run_defaults: z
        .object({
          max_clay_credits: z.number().int().nullable().default(null),
          max_tokens_usd: z.number().nullable().default(null),
        })
        .default({}),
    })
    .default({}),
  mvd: z.record(ModuleId, MvdStatus).default({}),
})
export type ClientManifest = z.infer<typeof ClientManifest>

export class ManifestError extends Error {
  constructor(
    message: string,
    readonly issues: z.ZodIssue[] = [],
  ) {
    super(message)
    this.name = 'ManifestError'
  }
}

/** Parse + validate a client.yaml document. */
export function parseManifest(yamlText: string): ClientManifest {
  let raw: unknown
  try {
    raw = parseYaml(yamlText)
  } catch (err) {
    throw new ManifestError(`client.yaml is not valid YAML: ${(err as Error).message}`)
  }
  const result = ClientManifest.safeParse(raw)
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
    throw new ManifestError(`client.yaml failed validation:\n${lines.join('\n')}`, result.error.issues)
  }
  return result.data
}

/**
 * Can this module run right now? Enabled, and MVD green — or yellow/red with
 * an explicit, attributed override. Unknown MVD never runs (the Day-1 Audit
 * must have written a status).
 */
export function moduleRunnable(manifest: ClientManifest, moduleId: string): { runnable: boolean; reason: string } {
  const mod = manifest.modules[moduleId]
  if (!mod) return { runnable: false, reason: `module ${moduleId} not present in manifest` }
  if (!mod.enabled) return { runnable: false, reason: `module ${moduleId} is disabled` }
  const mvd = manifest.mvd[moduleId]
  if (!mvd || mvd.status === 'unknown') {
    return mod.override_mvd
      ? { runnable: true, reason: `MVD unknown, overridden by ${mod.override_mvd.approved_by}: ${mod.override_mvd.reason}` }
      : { runnable: false, reason: `module ${moduleId} has no MVD status — run the Data Audit first` }
  }
  if (mvd.status === 'green') return { runnable: true, reason: 'MVD green' }
  if (mod.override_mvd) {
    return { runnable: true, reason: `MVD ${mvd.status}, overridden by ${mod.override_mvd.approved_by}: ${mod.override_mvd.reason}` }
  }
  const gaps = mvd.blocking_gaps.map((g) => `${g.field} at ${Math.round(g.coverage * 100)}% (needs ${Math.round(g.required * 100)}%)`)
  return { runnable: false, reason: `MVD ${mvd.status}: ${gaps.join(', ') || 'gaps unspecified'}` }
}
