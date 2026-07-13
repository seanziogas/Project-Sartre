import type { Account, Contact } from '@sartre/core'
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
  runId?: string
}

export interface CanonicalRefreshResult {
  accounts: PromotionResult<Account>
  contacts: PromotionResult<Contact>
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
    await Promise.all([
      this.staging.append(clientId, input.accountBatch),
      this.staging.append(clientId, input.contactBatch),
    ])

    const accountMapping = parseSourceMapping(input.accountMapping)
    const contactMapping = parseSourceMapping(input.contactMapping)
    assertObject(input.accountBatch, accountMapping, 'account')
    assertObject(input.contactBatch, contactMapping, 'contact')

    const accountCandidates = input.accountBatch.rows.map((row) => mapSourceRow(
      row,
      accountMapping,
      {
        clientId,
        connectorId: input.accountBatch.connectorId,
        extractedAt: input.accountBatch.extractedAt,
        ...(input.runId ? { runId: input.runId } : {}),
      },
    ))
    const accounts = await this.canonical.promoteAccounts(clientId, accountCandidates, options)

    const contactCandidates = input.contactBatch.rows.map((row) => mapSourceRow(
      row,
      contactMapping,
      {
        clientId,
        connectorId: input.contactBatch.connectorId,
        extractedAt: input.contactBatch.extractedAt,
        ...(input.runId ? { runId: input.runId } : {}),
      },
    ))
    const resolvedContacts = await resolveCandidateReferences(clientId, contactCandidates, this.canonical)
    const contacts = await this.canonical.promoteContacts(clientId, resolvedContacts, options)
    const audit = await this.canonical.auditRows(clientId)
    return { accounts, contacts, audit }
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

function assertObject(batch: StagedBatch, mapping: SourceMapping, expected: 'account' | 'contact'): void {
  if (batch.object !== expected) throw new Error(`expected ${expected} batch, received ${batch.object}`)
  if (mapping.object !== expected) throw new Error(`expected ${expected} mapping, received ${mapping.object}`)
}
