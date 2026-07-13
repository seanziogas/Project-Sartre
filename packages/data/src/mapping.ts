import {
  normalizeDomain,
  normalizeEmail,
  normalizeLinkedinUrl,
  Provenance,
} from '@sartre/core'
import type { Provenance as ProvenanceType } from '@sartre/core'
import { z } from 'zod'

const SourceObject = z.enum(['account', 'contact', 'opportunity', 'activity'])
export type SourceObject = z.infer<typeof SourceObject>

const Transform = z.enum([
  'identity',
  'string',
  'trim',
  'lowercase',
  'number',
  'boolean',
  'datetime',
  'domain',
  'email',
  'linkedin',
])

export const SourceMapping = z.object({
  object: SourceObject,
  externalIdField: z.string().min(1),
  fields: z.array(z.object({
    source: z.string().min(1),
    target: z.string().min(1),
    transform: Transform.default('identity'),
    required: z.boolean().default(false),
  })),
})
export type SourceMapping = z.infer<typeof SourceMapping>

const TARGETS: Record<SourceObject, Set<string>> = {
  account: new Set([
    'name', 'domain', 'industry', 'employeeCount', 'revenueUsd', 'revenueTier',
    'country', 'state', 'linkedinUrl', 'parentCompanyName', 'parentCompanyRevenueUsd',
    'accountType', 'ownerRef', 'sourceUpdatedAt', 'icpScore', 'icpGrade',
  ]),
  contact: new Set([
    'accountId', 'firstName', 'lastName', 'email', 'title', 'seniority',
    'linkedinUrl', 'country', 'employmentStatus', 'doNotContact', 'ownerRef', 'sourceUpdatedAt',
  ]),
  opportunity: new Set([
    'accountId', 'name', 'stage', 'amountUsd', 'closeDate', 'isClosed', 'isWon', 'lossReason',
  ]),
  activity: new Set([
    'accountId', 'contactId', 'type', 'occurredAt', 'direction', 'summary',
  ]),
}

export interface CanonicalCandidate {
  clientId: string
  connectorId: string
  observedAt: string
  object: SourceObject
  externalIds: Record<string, string>
  fields: Record<string, { value: string | number | boolean | null; provenance: ProvenanceType }>
  problems: string[]
}

/** Validate target vocabulary and ambiguity before a mapping can process rows. */
export function parseSourceMapping(input: unknown): SourceMapping {
  const mapping = SourceMapping.parse(input)
  const seen = new Set<string>()
  for (const field of mapping.fields) {
    if (!TARGETS[mapping.object].has(field.target)) {
      throw new Error(`${mapping.object} mapping target is not canonical: ${field.target}`)
    }
    if (seen.has(field.target)) throw new Error(`duplicate mapping target: ${field.target}`)
    seen.add(field.target)
  }
  return mapping
}

/**
 * Convert one staged CRM row into a provenance-bearing canonical candidate.
 * Raw rows remain in staging; invalid/missing values are surfaced, never dropped.
 */
export function mapSourceRow(
  row: Record<string, unknown>,
  mappingInput: SourceMapping | unknown,
  context: { clientId: string; connectorId: string; extractedAt: string; runId?: string },
): CanonicalCandidate {
  const mapping = parseSourceMapping(mappingInput)
  if (context.clientId.trim() === '') throw new Error('client id is required for source mapping')
  const problems: string[] = []
  const rawExternalId = row[mapping.externalIdField]
  const externalId = scalarString(rawExternalId)
  if (externalId === null) problems.push(`external id field ${mapping.externalIdField} is missing or invalid`)

  const provenance = Provenance.parse({
    source: 'crm',
    origin: context.connectorId,
    retrievedAt: context.extractedAt,
    confidence: 'high',
    ...(context.runId ? { runId: context.runId } : {}),
  })
  const fields: CanonicalCandidate['fields'] = {}
  for (const field of mapping.fields) {
    const raw = row[field.source]
    if ((raw === null || raw === undefined || raw === '') && field.required) {
      problems.push(`required source field ${field.source} is missing`)
      continue
    }
    const transformed = transform(raw, field.transform)
    if (!transformed.ok) {
      problems.push(`${field.source} → ${field.target}: ${transformed.problem}`)
      continue
    }
    fields[field.target] = { value: transformed.value, provenance }
  }

  return {
    clientId: context.clientId,
    connectorId: context.connectorId,
    observedAt: context.extractedAt,
    object: mapping.object,
    externalIds: externalId === null ? {} : { [context.connectorId]: externalId },
    fields,
    problems,
  }
}

type Scalar = string | number | boolean | null
type TransformResult = { ok: true; value: Scalar } | { ok: false; problem: string }

function transform(value: unknown, kind: z.infer<typeof Transform>): TransformResult {
  if (value === null || value === undefined || value === '') return { ok: true, value: null }
  switch (kind) {
    case 'identity':
      return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? { ok: true, value }
        : { ok: false, problem: 'value is not a scalar' }
    case 'string':
      return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? { ok: true, value: String(value) }
        : { ok: false, problem: 'value cannot be converted to string' }
    case 'trim':
      return typeof value === 'string'
        ? { ok: true, value: value.trim() || null }
        : { ok: false, problem: 'expected a string' }
    case 'lowercase':
      return typeof value === 'string'
        ? { ok: true, value: value.trim().toLowerCase() || null }
        : { ok: false, problem: 'expected a string' }
    case 'number': {
      const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(/[$,]/g, '')) : NaN
      return Number.isFinite(number) ? { ok: true, value: number } : { ok: false, problem: 'expected a finite number' }
    }
    case 'boolean':
      if (typeof value === 'boolean') return { ok: true, value }
      if (typeof value === 'string' && ['true', 'false', '1', '0'].includes(value.trim().toLowerCase())) {
        return { ok: true, value: ['true', '1'].includes(value.trim().toLowerCase()) }
      }
      return { ok: false, problem: 'expected a boolean' }
    case 'datetime': {
      if (typeof value !== 'string' && typeof value !== 'number') return { ok: false, problem: 'expected a timestamp' }
      const date = new Date(value)
      return Number.isNaN(date.getTime())
        ? { ok: false, problem: 'invalid timestamp' }
        : { ok: true, value: date.toISOString() }
    }
    case 'domain':
      if (typeof value !== 'string') return { ok: false, problem: 'expected a domain string' }
      return normalized(normalizeDomain(value), 'invalid domain')
    case 'email':
      if (typeof value !== 'string') return { ok: false, problem: 'expected an email string' }
      return normalized(normalizeEmail(value), 'invalid email')
    case 'linkedin':
      if (typeof value !== 'string') return { ok: false, problem: 'expected a LinkedIn string' }
      return normalized(normalizeLinkedinUrl(value), 'invalid LinkedIn URL')
  }
}

function normalized(value: string | null, problem: string): TransformResult {
  return value === null ? { ok: false, problem } : { ok: true, value }
}

function scalarString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}
