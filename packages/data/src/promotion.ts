import { randomUUID } from 'node:crypto'
import { Account, Activity, Contact, Opportunity, Provenance } from '@sartre/core'
import type {
  Account as AccountType,
  Activity as ActivityType,
  Contact as ContactType,
  Opportunity as OpportunityType,
  Provenance as ProvenanceType,
} from '@sartre/core'
import type { AuditAccountRow, AuditContactRow } from './audit.js'
import type { CanonicalCandidate } from './mapping.js'
import { resolveAccountDuplicates, resolveContactDuplicates } from './resolution.js'
import type { DuplicateGroup } from './resolution.js'

type Field = { value: string | number | null; provenance: ProvenanceType }

export interface PromotionProblem {
  candidateIndex: number
  externalIds: Record<string, string>
  problem: string
}

export interface PromotionResult<T> {
  records: T[]
  changedRecords: T[]
  duplicateGroups: DuplicateGroup[]
  problems: PromotionProblem[]
}

export interface PromotionOptions {
  now?: () => Date
  createId?: () => string
}

const ACCOUNT_FIELDS = [
  'name', 'domain', 'industry', 'employeeCount', 'revenueUsd', 'revenueTier',
  'country', 'state', 'linkedinUrl', 'parentCompanyName', 'parentCompanyRevenueUsd',
  'accountType', 'ownerRef', 'sourceUpdatedAt', 'icpScore', 'icpGrade',
] as const

const CONTACT_FIELDS = [
  'firstName', 'lastName', 'email', 'title', 'seniority', 'linkedinUrl',
  'country', 'employmentStatus', 'ownerRef', 'sourceUpdatedAt',
] as const

const OPPORTUNITY_FIELDS = ['name', 'stage', 'amountUsd', 'closeDate', 'lossReason'] as const

/** Promote account candidates without merging duplicates or deleting records. */
export function promoteAccountCandidates(
  clientId: string,
  candidates: CanonicalCandidate[],
  existing: AccountType[],
  options: PromotionOptions = {},
): PromotionResult<AccountType> {
  const now = options.now ?? (() => new Date())
  const createId = options.createId ?? randomUUID
  const original = new Map(existing.map((record) => [record.id, JSON.stringify(record)]))
  const records = existing.map((record) => structuredClone(record))
  const problems: PromotionProblem[] = []

  candidates.forEach((candidate, candidateIndex) => {
    for (const problem of candidate.problems) {
      problems.push({ candidateIndex, externalIds: candidate.externalIds, problem: `mapping: ${problem}` })
    }
    if (!validateCandidate(candidate, clientId, 'account', candidateIndex, problems)) return
    const matches = externalMatches(records, candidate.externalIds)
    if (matches.length > 1) {
      problems.push({ candidateIndex, externalIds: candidate.externalIds, problem: 'external ids match multiple account records' })
      return
    }
    const timestamp = now().toISOString()
    const raw = matches[0]
      ? mergeProvenancedRecord(matches[0], candidate, ACCOUNT_FIELDS, timestamp)
      : newAccount(candidate, clientId, createId(), timestamp)
    const parsed = Account.safeParse(raw)
    if (!parsed.success) {
      problems.push({
        candidateIndex,
        externalIds: candidate.externalIds,
        problem: `account failed canonical validation: ${formatIssues(parsed.error.issues)}`,
      })
      return
    }
    if (matches[0]) records[records.findIndex((record) => record.id === matches[0]!.id)] = parsed.data
    else records.push(parsed.data)
  })

  const duplicateGroups = resolveAccountDuplicates(records.map((record) => ({
    id: record.id,
    name: record.name.value,
    domain: record.domain.value,
    protected: record.flags.includes('excluded'),
  })))
  applyDuplicateFlags(records, duplicateGroups)
  return result(records, original, duplicateGroups, problems)
}

/** Promote contacts; account names provide the company key for fuzzy duplicate checks. */
export function promoteContactCandidates(
  clientId: string,
  candidates: CanonicalCandidate[],
  existing: ContactType[],
  accounts: AccountType[] = [],
  options: PromotionOptions = {},
): PromotionResult<ContactType> {
  const now = options.now ?? (() => new Date())
  const createId = options.createId ?? randomUUID
  const original = new Map(existing.map((record) => [record.id, JSON.stringify(record)]))
  const records = existing.map((record) => structuredClone(record))
  const problems: PromotionProblem[] = []

  candidates.forEach((candidate, candidateIndex) => {
    for (const problem of candidate.problems) {
      problems.push({ candidateIndex, externalIds: candidate.externalIds, problem: `mapping: ${problem}` })
    }
    if (!validateCandidate(candidate, clientId, 'contact', candidateIndex, problems)) return
    const matches = externalMatches(records, candidate.externalIds)
    if (matches.length > 1) {
      problems.push({ candidateIndex, externalIds: candidate.externalIds, problem: 'external ids match multiple contact records' })
      return
    }
    const timestamp = now().toISOString()
    const raw = matches[0]
      ? mergeContact(matches[0], candidate, timestamp)
      : newContact(candidate, clientId, createId(), timestamp)
    const parsed = Contact.safeParse(raw)
    if (!parsed.success) {
      problems.push({
        candidateIndex,
        externalIds: candidate.externalIds,
        problem: `contact failed canonical validation: ${formatIssues(parsed.error.issues)}`,
      })
      return
    }
    if (matches[0]) records[records.findIndex((record) => record.id === matches[0]!.id)] = parsed.data
    else records.push(parsed.data)
  })

  const accountNames = new Map(accounts.map((account) => [account.id, account.name.value]))
  const duplicateGroups = resolveContactDuplicates(records.map((record) => ({
    id: record.id,
    firstName: record.firstName.value,
    lastName: record.lastName.value,
    email: record.email.value,
    linkedinUrl: record.linkedinUrl.value,
    companyName: record.accountId ? accountNames.get(record.accountId) ?? null : null,
    protected: record.flags.includes('excluded'),
  })))
  applyDuplicateFlags(records, duplicateGroups)
  return result(records, original, duplicateGroups, problems)
}

/** Promote opportunities by source identity; relationship UUIDs are resolved before this boundary. */
export function promoteOpportunityCandidates(
  clientId: string,
  candidates: CanonicalCandidate[],
  existing: OpportunityType[],
  options: PromotionOptions = {},
): PromotionResult<OpportunityType> {
  const now = options.now ?? (() => new Date())
  const createId = options.createId ?? randomUUID
  const original = new Map(existing.map((record) => [record.id, JSON.stringify(record)]))
  const records = existing.map((record) => structuredClone(record))
  const problems: PromotionProblem[] = []

  candidates.forEach((candidate, candidateIndex) => {
    collectMappingProblems(candidate, candidateIndex, problems)
    if (!validateCandidate(candidate, clientId, 'opportunity', candidateIndex, problems)) return
    const matches = externalMatches(records, candidate.externalIds)
    if (matches.length > 1) {
      problems.push({ candidateIndex, externalIds: candidate.externalIds, problem: 'external ids match multiple opportunity records' })
      return
    }
    const timestamp = now().toISOString()
    const raw = matches[0]
      ? mergeOpportunity(matches[0], candidate, timestamp)
      : newOpportunity(candidate, clientId, createId(), timestamp)
    const parsed = Opportunity.safeParse(raw)
    if (!parsed.success) {
      problems.push({
        candidateIndex,
        externalIds: candidate.externalIds,
        problem: `opportunity failed canonical validation: ${formatIssues(parsed.error.issues)}`,
      })
      return
    }
    if (matches[0]) records[records.findIndex((record) => record.id === matches[0]!.id)] = parsed.data
    else records.push(parsed.data)
  })

  return result(records, original, [], problems)
}

/** Promote immutable-source activities without deduplicating separate events. */
export function promoteActivityCandidates(
  clientId: string,
  candidates: CanonicalCandidate[],
  existing: ActivityType[],
  options: PromotionOptions = {},
): PromotionResult<ActivityType> {
  const now = options.now ?? (() => new Date())
  const createId = options.createId ?? randomUUID
  const original = new Map(existing.map((record) => [record.id, JSON.stringify(record)]))
  const records = existing.map((record) => structuredClone(record))
  const problems: PromotionProblem[] = []

  candidates.forEach((candidate, candidateIndex) => {
    collectMappingProblems(candidate, candidateIndex, problems)
    if (!validateCandidate(candidate, clientId, 'activity', candidateIndex, problems)) return
    const matches = externalMatches(records, candidate.externalIds)
    if (matches.length > 1) {
      problems.push({ candidateIndex, externalIds: candidate.externalIds, problem: 'external ids match multiple activity records' })
      return
    }
    const timestamp = now().toISOString()
    const raw = matches[0]
      ? mergeActivity(matches[0], candidate, timestamp)
      : newActivity(candidate, clientId, createId(), timestamp)
    const parsed = Activity.safeParse(raw)
    if (!parsed.success) {
      problems.push({
        candidateIndex,
        externalIds: candidate.externalIds,
        problem: `activity failed canonical validation: ${formatIssues(parsed.error.issues)}`,
      })
      return
    }
    if (matches[0]) records[records.findIndex((record) => record.id === matches[0]!.id)] = parsed.data
    else records.push(parsed.data)
  })

  return result(records, original, [], problems)
}

export interface CanonicalClosedLostRow {
  id: string
  fields: Record<string, string | null>
}

/** Grade-ready closed-lost view backed only by tenant-scoped canonical records. */
export function canonicalClosedLostRows(
  accounts: AccountType[],
  opportunities: OpportunityType[],
): CanonicalClosedLostRow[] {
  const accountsById = new Map(accounts.map((account) => [account.id, account]))
  return opportunities
    .filter((opportunity) => opportunity.isClosed && opportunity.isWon === false && !opportunity.flags.includes('excluded'))
    .flatMap((opportunity) => {
      const account = opportunity.accountId ? accountsById.get(opportunity.accountId) : undefined
      if (account?.flags.includes('excluded')) return []
      return [{
        id: opportunity.id,
        fields: {
          account_name: account?.name.value ?? null,
          account_domain: account?.domain.value ?? null,
          account_industry: account?.industry.value ?? null,
          account_revenue_tier: account?.revenueTier.value ?? null,
          opportunity_name: opportunity.name.value,
          opportunity_stage: opportunity.stage.value,
          opportunity_amount_usd: opportunity.amountUsd.value === null ? null : String(opportunity.amountUsd.value),
          opportunity_close_date: opportunity.closeDate.value,
          opportunity_loss_reason: opportunity.lossReason.value,
        },
      }]
    })
}

/** Canonical account/contact records projected into the Day-1 audit contract. */
export function canonicalAuditRows(
  accounts: AccountType[],
  contacts: ContactType[],
): { accounts: AuditAccountRow[]; contacts: AuditContactRow[] } {
  const accountNames = new Map(accounts.map((account) => [account.id, account.name.value]))
  return {
    accounts: accounts.map((account) => ({
      id: account.id,
      name: account.name.value,
      domain: account.domain.value,
      protected: account.flags.includes('excluded'),
      ownerRef: account.ownerRef.value,
      updatedAt: account.sourceUpdatedAt.value,
      linkedinUrl: account.linkedinUrl.value,
    })),
    contacts: contacts.map((contact) => ({
      id: contact.id,
      firstName: contact.firstName.value,
      lastName: contact.lastName.value,
      email: contact.email.value,
      linkedinUrl: contact.linkedinUrl.value,
      companyName: contact.accountId ? accountNames.get(contact.accountId) ?? null : null,
      protected: contact.flags.includes('excluded'),
      accountRef: contact.accountId,
      ownerRef: contact.ownerRef.value,
      updatedAt: contact.sourceUpdatedAt.value,
    })),
  }
}

function validateCandidate(
  candidate: CanonicalCandidate,
  clientId: string,
  object: CanonicalCandidate['object'],
  candidateIndex: number,
  problems: PromotionProblem[],
): boolean {
  if (candidate.clientId !== clientId) {
    problems.push({ candidateIndex, externalIds: candidate.externalIds, problem: `candidate client ${candidate.clientId} does not match ${clientId}` })
    return false
  }
  if (candidate.object !== object) {
    problems.push({ candidateIndex, externalIds: candidate.externalIds, problem: `candidate object ${candidate.object} is not ${object}` })
    return false
  }
  if (Object.keys(candidate.externalIds).length === 0) {
    problems.push({ candidateIndex, externalIds: {}, problem: 'candidate has no external id and cannot be promoted' })
    return false
  }
  return true
}

function newAccount(candidate: CanonicalCandidate, clientId: string, id: string, timestamp: string): Record<string, unknown> {
  const record: Record<string, unknown> = base(candidate, clientId, id, timestamp)
  for (const field of ACCOUNT_FIELDS) record[field] = candidate.fields[field] ?? missingField(candidate)
  if (ACCOUNT_FIELDS.some((field) => !candidate.fields[field])) record.flags = ['needs_review']
  return record
}

function newContact(candidate: CanonicalCandidate, clientId: string, id: string, timestamp: string): Record<string, unknown> {
  const record: Record<string, unknown> = base(candidate, clientId, id, timestamp)
  for (const field of CONTACT_FIELDS) record[field] = candidate.fields[field] ?? missingField(candidate)
  record.accountId = scalar(candidate, 'accountId', null)
  record.doNotContact = scalar(candidate, 'doNotContact', false)
  if (CONTACT_FIELDS.some((field) => !candidate.fields[field])) record.flags = ['needs_review']
  return record
}

function newOpportunity(candidate: CanonicalCandidate, clientId: string, id: string, timestamp: string): Record<string, unknown> {
  const record: Record<string, unknown> = base(candidate, clientId, id, timestamp)
  for (const field of OPPORTUNITY_FIELDS) record[field] = candidate.fields[field] ?? missingField(candidate)
  record.accountId = scalar(candidate, 'accountId', null)
  record.isClosed = scalar(candidate, 'isClosed', false)
  record.isWon = scalar(candidate, 'isWon', null)
  if (OPPORTUNITY_FIELDS.some((field) => !candidate.fields[field])) record.flags = ['needs_review']
  return record
}

function newActivity(candidate: CanonicalCandidate, clientId: string, id: string, timestamp: string): Record<string, unknown> {
  return {
    ...base(candidate, clientId, id, timestamp),
    accountId: scalar(candidate, 'accountId', null),
    contactId: scalar(candidate, 'contactId', null),
    type: scalar(candidate, 'type', null),
    occurredAt: scalar(candidate, 'occurredAt', null),
    direction: scalar(candidate, 'direction', null),
    summary: scalar(candidate, 'summary', ''),
    provenance: candidateProvenance(candidate),
  }
}

function base(candidate: CanonicalCandidate, clientId: string, id: string, timestamp: string) {
  return {
    id,
    clientId,
    externalIds: candidate.externalIds,
    createdAt: timestamp,
    updatedAt: timestamp,
    flags: candidate.problems.length > 0 ? ['needs_review'] : [],
  }
}

function mergeProvenancedRecord<T extends AccountType | ContactType | OpportunityType>(
  existing: T,
  candidate: CanonicalCandidate,
  fields: readonly string[],
  timestamp: string,
): T {
  const record = structuredClone(existing) as T & Record<string, unknown>
  record.externalIds = { ...record.externalIds, ...candidate.externalIds }
  record.updatedAt = timestamp
  for (const field of fields) {
    const incoming = candidate.fields[field]
    if (incoming) record[field] = chooseField(record[field] as Field, incoming as Field)
  }
  if (candidate.problems.length > 0 && !record.flags.includes('needs_review')) record.flags.push('needs_review')
  return record
}

function mergeContact(existing: ContactType, candidate: CanonicalCandidate, timestamp: string): ContactType {
  const record = mergeProvenancedRecord(existing, candidate, CONTACT_FIELDS, timestamp)
  if (candidate.fields.accountId) record.accountId = scalar(candidate, 'accountId', null) as string | null
  if (candidate.fields.doNotContact) record.doNotContact = scalar(candidate, 'doNotContact', false) as boolean
  return record
}

function mergeOpportunity(existing: OpportunityType, candidate: CanonicalCandidate, timestamp: string): OpportunityType {
  const record = mergeProvenancedRecord(existing, candidate, OPPORTUNITY_FIELDS, timestamp)
  if (candidate.fields.accountId) record.accountId = scalar(candidate, 'accountId', null) as string | null
  if (candidate.fields.isClosed) record.isClosed = scalar(candidate, 'isClosed', false) as boolean
  if (candidate.fields.isWon) record.isWon = scalar(candidate, 'isWon', null) as boolean | null
  return record
}

function mergeActivity(existing: ActivityType, candidate: CanonicalCandidate, timestamp: string): ActivityType {
  const incomingProvenance = candidateProvenance(candidate)
  const record = structuredClone(existing)
  record.externalIds = { ...record.externalIds, ...candidate.externalIds }
  record.updatedAt = timestamp
  if (existing.provenance.source === 'human' && incomingProvenance.source !== 'human') return record
  if (candidate.fields.accountId) record.accountId = scalar(candidate, 'accountId', null) as string | null
  if (candidate.fields.contactId) record.contactId = scalar(candidate, 'contactId', null) as string | null
  if (candidate.fields.type) record.type = scalar(candidate, 'type', null) as ActivityType['type']
  if (candidate.fields.occurredAt) record.occurredAt = scalar(candidate, 'occurredAt', null) as string
  if (candidate.fields.direction) record.direction = scalar(candidate, 'direction', null) as ActivityType['direction']
  if (candidate.fields.summary) record.summary = scalar(candidate, 'summary', '') as string
  record.provenance = incomingProvenance
  if (candidate.problems.length > 0 && !record.flags.includes('needs_review')) record.flags.push('needs_review')
  return record
}

function chooseField(existing: Field, incoming: Field): Field {
  if (existing.provenance.source === 'human' && incoming.provenance.source !== 'human') return existing
  if (incoming.provenance.source === 'human' && existing.provenance.source !== 'human') return incoming
  const confidence = { needs_review: 0, low: 1, medium: 2, high: 3 }
  const incomingConfidence = confidence[incoming.provenance.confidence]
  const existingConfidence = confidence[existing.provenance.confidence]
  if (incomingConfidence !== existingConfidence) return incomingConfidence > existingConfidence ? incoming : existing
  return incoming.provenance.retrievedAt >= existing.provenance.retrievedAt ? incoming : existing
}

function missingField(candidate: CanonicalCandidate): Field {
  return {
    value: null,
    provenance: Provenance.parse({
      source: 'crm',
      origin: candidate.connectorId,
      retrievedAt: candidate.observedAt,
      confidence: 'needs_review',
    }),
  }
}

function candidateProvenance(candidate: CanonicalCandidate): ProvenanceType {
  const first = Object.values(candidate.fields)[0]?.provenance ?? candidate.references[0]?.provenance
  return first ?? Provenance.parse({
    source: 'crm',
    origin: candidate.connectorId,
    retrievedAt: candidate.observedAt,
    confidence: 'needs_review',
  })
}

function collectMappingProblems(
  candidate: CanonicalCandidate,
  candidateIndex: number,
  problems: PromotionProblem[],
): void {
  for (const problem of candidate.problems) {
    problems.push({ candidateIndex, externalIds: candidate.externalIds, problem: `mapping: ${problem}` })
  }
}

function scalar(candidate: CanonicalCandidate, field: string, fallback: string | boolean | null) {
  return candidate.fields[field]?.value ?? fallback
}

function externalMatches<T extends { externalIds: Record<string, string> }>(records: T[], externalIds: Record<string, string>): T[] {
  return records.filter((record) => Object.entries(externalIds).some(([system, id]) => record.externalIds[system] === id))
}

function applyDuplicateFlags<T extends { id: string; flags: AccountType['flags']; duplicateGroupId?: string | undefined }>(
  records: T[],
  groups: DuplicateGroup[],
): void {
  for (const record of records) {
    record.flags = record.flags.filter((flag) => flag !== 'duplicate')
    delete record.duplicateGroupId
  }
  const byId = new Map(records.map((record) => [record.id, record]))
  for (const group of groups) {
    for (const id of group.memberIds) {
      const record = byId.get(id)
      if (!record) continue
      record.flags.push('duplicate')
      record.duplicateGroupId = group.key
    }
  }
}

function result<T extends { id: string }>(
  records: T[],
  original: Map<string, string>,
  duplicateGroups: DuplicateGroup[],
  problems: PromotionProblem[],
): PromotionResult<T> {
  return {
    records,
    changedRecords: records.filter((record) => original.get(record.id) !== JSON.stringify(record)),
    duplicateGroups,
    problems,
  }
}

function formatIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')
}
