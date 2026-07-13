import type { Account, Contact, Opportunity, Activity } from '@sartre/core'
import { z } from 'zod'

/**
 * Connector contract (Layer 2). Every tool connector implements the slice of
 * this that its tool supports; capability flags tell pipelines what they can
 * ask for. Connectors are MCP-backed in production; tests use in-memory fakes.
 *
 * Non-negotiables enforced at this boundary:
 *  - reads land in staging (the caller normalizes into canonical records)
 *  - writes go ONLY to namespaced fields, and only after a snapshot exists
 */

export interface ConnectorInfo {
  id: string // e.g. "salesforce", "hubspot", "clay", "slack", "fathom"
  kind: 'crm' | 'enrichment' | 'sequencer' | 'comms' | 'meetings' | 'intent' | 'warehouse' | 'inbound'
  capabilities: Capability[]
}

export type Capability =
  | 'read_accounts'
  | 'read_contacts'
  | 'read_opportunities'
  | 'read_activities'
  | 'read_leads'
  | 'read_intent_signals'
  | 'write_namespaced_fields'
  | 'snapshot'
  | 'enrich'
  | 'send_message'
  | 'read_transcripts'
  | 'convert_leads'

/** Raw rows exactly as the source system returned them, plus extraction metadata. */
export interface StagedBatch<T = Record<string, unknown>> {
  connectorId: string
  object: 'account' | 'contact' | 'opportunity' | 'activity' | 'lead' | 'signal'
  extractedAt: string
  cursor: string | null // resume point for incremental pulls
  rows: T[]
}

/** Runtime boundary: raw connector payloads are untrusted even when the adapter is typed. */
export const StagedBatchSchema = z.object({
  connectorId: z.string().min(1),
  object: z.enum(['account', 'contact', 'opportunity', 'activity', 'lead', 'signal']),
  extractedAt: z.string().datetime(),
  cursor: z.string().nullable(),
  rows: z.array(z.record(z.string(), z.unknown())),
})

/** Normalized intent event produced from a raw, staged provider row. */
export const IntentEvent = z.object({
  clientId: z.string().min(1),
  sourceSystem: z.string().min(1),
  externalId: z.string().min(1),
  companyDomain: z.string().nullable().default(null),
  companyName: z.string().nullable().default(null),
  kind: z.string().min(1),
  occurredAt: z.string().datetime(),
  detail: z.string().default(''),
})
export type IntentEvent = z.infer<typeof IntentEvent>

export interface IntentReader {
  info: ConnectorInfo
  /** Raw provider payloads must be staged before they are mapped to IntentEvent. */
  pullSignals(cursor?: string): Promise<StagedBatch>
}

export interface CrmReader {
  info: ConnectorInfo
  pullAccounts(cursor?: string): Promise<StagedBatch>
  pullContacts(cursor?: string): Promise<StagedBatch>
  pullOpportunities(cursor?: string): Promise<StagedBatch>
  pullActivities(cursor?: string): Promise<StagedBatch>
  pullLeads(cursor?: string): Promise<StagedBatch>
}

export const LeadConversionRequest = z.object({
  leadExternalId: z.string().min(1),
  targetAccountExternalId: z.string().min(1).nullable(),
  createAccount: z.boolean(),
}).superRefine((request, ctx) => {
  if (request.createAccount === (request.targetAccountExternalId !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'conversion must either create an account or target one existing account' })
  }
})
export type LeadConversionRequest = z.infer<typeof LeadConversionRequest>

export interface LeadConversionReceipt {
  converted: number
  rejected: { request: LeadConversionRequest; reason: string }[]
  snapshotRef: string
}

export interface LeadConverter {
  info: ConnectorInfo
  snapshotLeads(requests: LeadConversionRequest[]): Promise<string>
  convertLeads(requests: LeadConversionRequest[], snapshotRef: string): Promise<LeadConversionReceipt>
}

export interface NamespacedWrite {
  object: 'account' | 'contact' | 'opportunity'
  externalId: string
  /** Field names MUST carry the manifest's namespace prefix — enforced before dispatch. */
  fields: Record<string, string | number | boolean | null>
}

export interface WriteReceipt {
  written: number
  rejected: { write: NamespacedWrite; reason: string }[]
  snapshotRef: string // proof a snapshot existed before the write
}

export interface CrmWriter {
  info: ConnectorInfo
  /** Capture the current values of every field about to be touched. Returns a snapshot ref. */
  snapshot(writes: NamespacedWrite[]): Promise<string>
  writeNamespaced(writes: NamespacedWrite[], snapshotRef: string): Promise<WriteReceipt>
}

/**
 * Guard used by every pipeline before dispatching CRM writes: rejects any
 * field that doesn't carry the client's namespace prefix. This is what makes
 * "we never touch client-owned fields" structural instead of disciplinary.
 */
export function partitionNamespacedWrites(
  writes: NamespacedWrite[],
  namespacePrefix: string,
): { allowed: NamespacedWrite[]; rejected: { write: NamespacedWrite; reason: string }[] } {
  if (namespacePrefix.trim() === '') throw new Error('CRM namespace prefix is required')
  const allowed: NamespacedWrite[] = []
  const rejected: { write: NamespacedWrite; reason: string }[] = []
  for (const write of writes) {
    const badFields = Object.keys(write.fields).filter((f) => !f.startsWith(namespacePrefix))
    if (badFields.length > 0) {
      rejected.push({ write, reason: `fields outside namespace ${namespacePrefix}: ${badFields.join(', ')}` })
    } else {
      allowed.push(write)
    }
  }
  return { allowed, rejected }
}

/** Canonical-typed views a normalizer produces from staged rows. */
export interface NormalizedPull {
  accounts: Account[]
  contacts: Contact[]
  opportunities: Opportunity[]
  activities: Activity[]
}
