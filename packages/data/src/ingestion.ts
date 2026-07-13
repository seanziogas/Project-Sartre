import type { Account, Activity, Contact, Opportunity } from '@sartre/core'
import type { StagedBatch } from '@sartre/connectors'
import type { AuditAccountRow, AuditContactRow } from './audit.js'
import { mapSourceRow, parseSourceMapping } from './mapping.js'
import type { CanonicalCandidate, SourceMapping } from './mapping.js'
import type { PromotionOptions, PromotionResult } from './promotion.js'

export interface StagingPort {
  append(clientId: string, batch: StagedBatch, idempotencyKey?: string): Promise<unknown>
}

export interface CanonicalIngestionPort {
  promoteAccounts(
    clientId: string,
    candidates: CanonicalCandidate[],
    options?: PromotionOptions,
  ): Promise<PromotionResult<Account>>
  promoteContacts(
    clientId: string,
    candidates: CanonicalCandidate[],
    options?: PromotionOptions,
  ): Promise<PromotionResult<Contact>>
  promoteOpportunities(
    clientId: string,
    candidates: CanonicalCandidate[],
    options?: PromotionOptions,
  ): Promise<PromotionResult<Opportunity>>
  promoteActivities(
    clientId: string,
    candidates: CanonicalCandidate[],
    options?: PromotionOptions,
  ): Promise<PromotionResult<Activity>>
  findByExternalId(
    clientId: string,
    recordType: 'account' | 'contact',
    system: string,
    externalId: string,
  ): Promise<{ id: string } | null>
  auditRows(clientId: string): Promise<{ accounts: AuditAccountRow[]; contacts: AuditContactRow[] }>
}

export interface CanonicalRefreshInput {
  accountBatch: StagedBatch
  contactBatch: StagedBatch
  accountMapping: SourceMapping | unknown
  contactMapping: SourceMapping | unknown
  opportunityBatch?: StagedBatch
  opportunityMapping?: SourceMapping | unknown
  activityBatch?: StagedBatch
  activityMapping?: SourceMapping | unknown
  runId?: string
}

export interface CanonicalRefreshResult {
  accounts: PromotionResult<Account>
  contacts: PromotionResult<Contact>
  opportunities?: PromotionResult<Opportunity>
  activities?: PromotionResult<Activity>
  audit: { accounts: AuditAccountRow[]; contacts: AuditContactRow[] }
}

/**
 * Reusable ingestion flow for CRM refreshes. Accounts promote first so contact
 * source references can resolve to canonical UUIDs inside the same refresh.
 */
export class CanonicalIngestionCoordinator {
  constructor(
    private readonly staging: StagingPort,
    private readonly canonical: CanonicalIngestionPort,
  ) {}

  async refresh(
    clientId: string,
    input: CanonicalRefreshInput,
    options: PromotionOptions = {},
  ): Promise<CanonicalRefreshResult> {
    assertOptionalPair(input.opportunityBatch, input.opportunityMapping, 'opportunity')
    assertOptionalPair(input.activityBatch, input.activityMapping, 'activity')
    const batches = [input.accountBatch, input.contactBatch]
    if (input.opportunityBatch) batches.push(input.opportunityBatch)
    if (input.activityBatch) batches.push(input.activityBatch)
    await Promise.all(batches.map((batch) => this.staging.append(clientId, batch)))

    const accountMapping = parseSourceMapping(input.accountMapping)
    const contactMapping = parseSourceMapping(input.contactMapping)
    const opportunityMapping = input.opportunityMapping === undefined
      ? undefined
      : parseSourceMapping(input.opportunityMapping)
    const activityMapping = input.activityMapping === undefined
      ? undefined
      : parseSourceMapping(input.activityMapping)
    assertObject(input.accountBatch, accountMapping, 'account')
    assertObject(input.contactBatch, contactMapping, 'contact')
    if (input.opportunityBatch && opportunityMapping) {
      assertObject(input.opportunityBatch, opportunityMapping, 'opportunity')
    }
    if (input.activityBatch && activityMapping) {
      assertObject(input.activityBatch, activityMapping, 'activity')
    }

    const accountCandidates = mapBatch(clientId, input.accountBatch, accountMapping, input.runId)
    const accounts = await this.canonical.promoteAccounts(clientId, accountCandidates, options)

    const contactCandidates = mapBatch(clientId, input.contactBatch, contactMapping, input.runId)
    const resolvedContacts = await resolveCandidateReferences(clientId, contactCandidates, this.canonical)
    const contacts = await this.canonical.promoteContacts(clientId, resolvedContacts, options)

    let opportunities: PromotionResult<Opportunity> | undefined
    if (input.opportunityBatch && opportunityMapping) {
      const candidates = mapBatch(clientId, input.opportunityBatch, opportunityMapping, input.runId)
      opportunities = await this.canonical.promoteOpportunities(
        clientId,
        await resolveCandidateReferences(clientId, candidates, this.canonical),
        options,
      )
    }

    let activities: PromotionResult<Activity> | undefined
    if (input.activityBatch && activityMapping) {
      const candidates = mapBatch(clientId, input.activityBatch, activityMapping, input.runId)
      activities = await this.canonical.promoteActivities(
        clientId,
        await resolveCandidateReferences(clientId, candidates, this.canonical),
        options,
      )
    }
    const audit = await this.canonical.auditRows(clientId)
    return { accounts, contacts, ...(opportunities ? { opportunities } : {}), ...(activities ? { activities } : {}), audit }
  }
}

/** Resolve relationship external IDs without ever dropping unresolved rows. */
export async function resolveCandidateReferences(
  clientId: string,
  candidates: CanonicalCandidate[],
  lookup: Pick<CanonicalIngestionPort, 'findByExternalId'>,
): Promise<CanonicalCandidate[]> {
  const resolved: CanonicalCandidate[] = []
  for (const input of candidates) {
    const candidate = structuredClone(input)
    if (candidate.clientId !== clientId) {
      candidate.problems.push(`candidate client ${candidate.clientId} does not match reference scope ${clientId}`)
      resolved.push(candidate)
      continue
    }
    for (const reference of candidate.references) {
      const record = await lookup.findByExternalId(
        clientId,
        reference.recordType,
        reference.system,
        reference.externalId,
      )
      if (!record) {
        candidate.problems.push(
          `unresolved ${reference.recordType} reference ${reference.system}:${reference.externalId} for ${reference.target}`,
        )
        continue
      }
      candidate.fields[reference.target] = { value: record.id, provenance: reference.provenance }
    }
    resolved.push(candidate)
  }
  return resolved
}

function mapBatch(
  clientId: string,
  batch: StagedBatch,
  mapping: SourceMapping,
  runId?: string,
): CanonicalCandidate[] {
  return batch.rows.map((row) => mapSourceRow(row, mapping, {
    clientId,
    connectorId: batch.connectorId,
    extractedAt: batch.extractedAt,
    ...(runId ? { runId } : {}),
  }))
}

function assertObject(batch: StagedBatch, mapping: SourceMapping, expected: SourceMapping['object']): void {
  if (batch.object !== expected) throw new Error(`expected ${expected} batch, received ${batch.object}`)
  if (mapping.object !== expected) throw new Error(`expected ${expected} mapping, received ${mapping.object}`)
}

function assertOptionalPair(
  batch: StagedBatch | undefined,
  mapping: SourceMapping | unknown | undefined,
  object: 'opportunity' | 'activity',
): void {
  if ((batch === undefined) !== (mapping === undefined)) {
    throw new Error(`${object} batch and mapping must be provided together`)
  }
}
