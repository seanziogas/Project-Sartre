import { z } from 'zod'

/**
 * Per-field provenance (Design Principle 4). Every value in a golden record
 * knows where it came from, when, and how much to trust it — this is what
 * makes flag-don't-delete and the enrichment cache auditable.
 */
export const ProvenanceSource = z.enum([
  'crm', // read from the client's CRM
  'enrichment', // a paid enrichment provider (via Clay or direct)
  'cache', // portfolio enrichment cache hit
  'web', // fetched/scraped from the public web
  'inference', // derived by a skill (LLM or rule)
  'human', // entered or corrected by a person
])
export type ProvenanceSource = z.infer<typeof ProvenanceSource>

export const Confidence = z.enum(['high', 'medium', 'low', 'needs_review'])
export type Confidence = z.infer<typeof Confidence>

export const Provenance = z.object({
  source: ProvenanceSource,
  /** Specific origin: connector id, provider name, skill id, or person. */
  origin: z.string().min(1),
  retrievedAt: z.string().datetime(),
  confidence: Confidence,
  /** Set when the value came from a specific run (links to the run journal). */
  runId: z.string().optional(),
})
export type Provenance = z.infer<typeof Provenance>

/** A value plus where it came from. Null value = known-absent (checked, not found). */
export function provenanced<T extends z.ZodTypeAny>(value: T) {
  return z.object({
    value: value.nullable(),
    provenance: Provenance,
  })
}

export const ProvenancedString = provenanced(z.string())
export type ProvenancedString = z.infer<typeof ProvenancedString>
export const ProvenancedNumber = provenanced(z.number())
export type ProvenancedNumber = z.infer<typeof ProvenancedNumber>
