import { z } from 'zod'
import { provenanced, Provenance } from './provenance.js'

/**
 * Canonical data model (Layer 7). Every instance maintains this normalized
 * store, mapped from whatever shape the client's CRM is in. Skills read and
 * write ONLY the canonical layer; the mapping layer translates back through
 * namespaced CRM fields.
 *
 * Golden records carry per-field provenance. `externalIds` preserves the link
 * back to source-system rows (never destructive — the CRM stays authoritative
 * for its own ids).
 */

const pstr = provenanced(z.string())
const pnum = provenanced(z.number())

export const ExternalIds = z.record(z.string(), z.string()) // system → id, e.g. { salesforce: "001..." }
export type ExternalIds = z.infer<typeof ExternalIds>

const goldenBase = {
  id: z.string().uuid(),
  clientId: z.string().min(1), // tenancy key — hard boundary at the storage layer
  externalIds: ExternalIds.default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  /** Flag-don't-delete: records are never removed, only flagged. */
  flags: z.array(z.enum(['duplicate', 'needs_review', 'inactive', 'excluded'])).default([]),
  duplicateGroupId: z.string().optional(),
}

export const Account = z.object({
  ...goldenBase,
  name: pstr,
  domain: pstr, // normalized: lowercase, no www, no trailing path
  industry: pstr,
  employeeCount: pnum,
  revenueUsd: pnum,
  revenueTier: pstr, // client-defined bands, e.g. "Under $100M" | "$100M+"
  country: pstr,
  state: pstr,
  linkedinUrl: pstr,
  parentCompanyName: pstr, // text only — never auto-create a parent record
  parentCompanyRevenueUsd: pnum, // routing uses parent, enrichment uses subsidiary
  accountType: pstr, // customer | prospect | competitor | partner | ... (client picklist)
  ownerRef: pstr, // CRM owner (data audit + routing integrity checks read this)
  sourceUpdatedAt: pstr, // source-system last-modified timestamp; distinct from canonical updatedAt
  icpScore: pnum,
  icpGrade: pstr,
})
export type Account = z.infer<typeof Account>

export const Contact = z.object({
  ...goldenBase,
  accountId: z.string().uuid().nullable(),
  firstName: pstr,
  lastName: pstr,
  email: pstr, // lowercase
  title: pstr,
  seniority: pstr,
  linkedinUrl: pstr,
  country: pstr,
  employmentStatus: pstr, // Current | Former | Unrelated (employment-validation standard)
  doNotContact: z.boolean().default(false),
  ownerRef: pstr, // CRM owner (routing integrity checks read this)
  sourceUpdatedAt: pstr, // source-system last-modified timestamp for staleness audits
})
export type Contact = z.infer<typeof Contact>

export const Opportunity = z.object({
  ...goldenBase,
  accountId: z.string().uuid().nullable(),
  name: pstr,
  stage: pstr,
  amountUsd: pnum,
  closeDate: pstr, // ISO date
  isClosed: z.boolean().default(false),
  isWon: z.boolean().nullable().default(null),
  lossReason: pstr,
})
export type Opportunity = z.infer<typeof Opportunity>

export const Activity = z.object({
  ...goldenBase,
  accountId: z.string().uuid().nullable(),
  contactId: z.string().uuid().nullable(),
  type: z.enum(['email', 'call', 'meeting', 'reply', 'note', 'sequence_step', 'form_fill', 'other']),
  occurredAt: z.string().datetime(),
  direction: z.enum(['inbound', 'outbound', 'internal']).nullable(),
  summary: z.string().default(''),
  provenance: Provenance,
})
export type Activity = z.infer<typeof Activity>

export const Signal = z.object({
  ...goldenBase,
  accountId: z.string().uuid().nullable(),
  contactId: z.string().uuid().nullable(),
  /** Signal key from the client brain's signals.md (e.g. "international-expansion"). */
  kind: z.string().min(1),
  observedAt: z.string().datetime(),
  detail: z.string().default(''),
  provenance: Provenance,
  /** Set when a play was triggered off this signal (links to the run journal). */
  actedOnByRunId: z.string().optional(),
})
export type Signal = z.infer<typeof Signal>
