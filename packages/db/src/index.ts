import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { Account, Activity, Contact, Opportunity, Signal } from '@sartre/core'
import type {
  Account as AccountType,
  Activity as ActivityType,
  Contact as ContactType,
  FeedbackEvent,
  Opportunity as OpportunityType,
  Signal as SignalType,
} from '@sartre/core'
import { StagedBatchSchema } from '@sartre/connectors'
import type { CacheEntry, CacheStore, StagedBatch } from '@sartre/connectors'
import {
  canonicalAuditRows,
  canonicalClosedLostRows,
  promoteAccountCandidates,
  promoteActivityCandidates,
  promoteContactCandidates,
  promoteOpportunityCandidates,
} from '@sartre/data'
import type {
  AuditAccountRow,
  AuditContactRow,
  CanonicalClosedLostRow,
  CanonicalCandidate,
  PromotionOptions,
  PromotionResult,
} from '@sartre/data'
import { applyGateDecision } from '@sartre/pipelines'
import type { GateDecisionInput, RunnerStore, RunRecord, RunStatus } from '@sartre/pipelines'
import { Pool } from 'pg'

/**
 * Postgres adapters (Phase 2). Storage-shape decisions:
 *  - documents live as JSONB (validated by zod at the boundaries), with the
 *    columns queries actually filter on promoted to real columns
 *  - tenancy: client_id is a real, indexed column on every table — the
 *    hard boundary at the storage layer (PLAN §8.4)
 *
 * `Queryable` matches both pg.Pool and PGlite, so tests run against an
 * in-process Postgres and production wires a real pool with zero changes.
 */
export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>
}

export interface PostgresConnection extends Queryable {
  close(): Promise<void>
}

/** Production pg.Pool behind the same narrow boundary used by PGlite tests. */
export function createPostgresConnection(
  connectionString: string,
  options: { maxConnections?: number } = {},
): PostgresConnection {
  if (connectionString.trim() === '') throw new Error('DATABASE_URL is required')
  const pool = new Pool({
    connectionString,
    max: options.maxConnections ?? 10,
  })
  return {
    query: async (sql, params) => {
      const result = await pool.query(sql, params)
      return { rows: result.rows as unknown[] }
    },
    close: async () => pool.end(),
  }
}

export async function migrate(db: Queryable): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS runs (
      run_id      text PRIMARY KEY,
      client_id   text NOT NULL,
      pipeline_id text NOT NULL,
      module_id   text NOT NULL,
      status      text NOT NULL,
      doc         jsonb NOT NULL,
      created_at  timestamptz NOT NULL,
      updated_at  timestamptz NOT NULL
    );
    CREATE INDEX IF NOT EXISTS runs_client_idx ON runs (client_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS runs_status_idx ON runs (status);

    CREATE TABLE IF NOT EXISTS enrichment_cache (
      domain     text PRIMARY KEY,
      entry      jsonb NOT NULL,
      updated_at timestamptz NOT NULL
    );

    CREATE TABLE IF NOT EXISTS feedback_events (
      id          text PRIMARY KEY,
      client_id   text NOT NULL,
      kind        text NOT NULL,
      occurred_at timestamptz NOT NULL,
      event       jsonb NOT NULL
    );
    CREATE INDEX IF NOT EXISTS feedback_client_idx ON feedback_events (client_id, occurred_at DESC);

    CREATE TABLE IF NOT EXISTS staged_batches (
      batch_id      text PRIMARY KEY,
      client_id     text NOT NULL,
      connector_id  text NOT NULL,
      object_type   text NOT NULL CHECK (object_type IN ('account', 'contact', 'opportunity', 'activity')),
      extracted_at timestamptz NOT NULL,
      cursor_value  text,
      batch         jsonb NOT NULL,
      created_at    timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS staged_client_idx
      ON staged_batches (client_id, connector_id, object_type, extracted_at DESC);

    CREATE TABLE IF NOT EXISTS canonical_records (
      client_id    text NOT NULL,
      record_type  text NOT NULL CHECK (record_type IN ('account', 'contact', 'opportunity', 'activity', 'signal')),
      record_id    uuid NOT NULL,
      external_ids jsonb NOT NULL,
      doc           jsonb NOT NULL,
      created_at    timestamptz NOT NULL,
      updated_at    timestamptz NOT NULL,
      PRIMARY KEY (client_id, record_type, record_id)
    );
    CREATE INDEX IF NOT EXISTS canonical_client_type_idx
      ON canonical_records (client_id, record_type, updated_at DESC);
    CREATE INDEX IF NOT EXISTS canonical_external_ids_idx
      ON canonical_records USING gin (external_ids);
  `)
}

export interface StoredStagedBatch {
  batchId: string
  clientId: string
  batch: StagedBatch
}

/** Append-only raw connector staging. Exact retries are content-idempotent. */
export class PostgresStagingStore {
  constructor(private readonly db: Queryable) {}

  async append(clientId: string, input: StagedBatch, idempotencyKey?: string): Promise<StoredStagedBatch> {
    assertClientId(clientId)
    const batch = StagedBatchSchema.parse(input) as StagedBatch
    const batchId = idempotencyKey?.trim() || createHash('sha256')
      .update(JSON.stringify({ clientId, batch }))
      .digest('hex')
    await this.db.query(
      `INSERT INTO staged_batches
         (batch_id, client_id, connector_id, object_type, extracted_at, cursor_value, batch)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (batch_id) DO NOTHING`,
      [batchId, clientId, batch.connectorId, batch.object, batch.extractedAt, batch.cursor, JSON.stringify(batch)],
    )
    const stored = await this.get(clientId, batchId)
    if (!stored) throw new Error(`staged batch ${batchId} collided with another client`)
    // Postgres JSONB does not preserve object key order, so compare parsed
    // values instead of their serialized property order.
    if (!isDeepStrictEqual(stored.batch, batch)) {
      throw new Error(`staged batch idempotency key ${batchId} was reused with different content`)
    }
    return stored
  }

  async get(clientId: string, batchId: string): Promise<StoredStagedBatch | null> {
    assertClientId(clientId)
    const { rows } = await this.db.query(
      'SELECT batch_id, client_id, batch FROM staged_batches WHERE client_id = $1 AND batch_id = $2',
      [clientId, batchId],
    )
    return rows.length === 0 ? null : stagedRow(rows[0])
  }

  async list(
    clientId: string,
    filters: { connectorId?: string; object?: StagedBatch['object']; limit?: number } = {},
  ): Promise<StoredStagedBatch[]> {
    assertClientId(clientId)
    const limit = filters.limit ?? 100
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('staging list limit must be 1-1000')
    const { rows } = await this.db.query(
      `SELECT batch_id, client_id, batch FROM staged_batches
       WHERE client_id = $1
         AND ($2::text IS NULL OR connector_id = $2)
         AND ($3::text IS NULL OR object_type = $3)
       ORDER BY extracted_at DESC LIMIT $4`,
      [clientId, filters.connectorId ?? null, filters.object ?? null, limit],
    )
    return rows.map(stagedRow)
  }
}

export type CanonicalRecordType = 'account' | 'contact' | 'opportunity' | 'activity' | 'signal'
export type CanonicalRecord = AccountType | ContactType | OpportunityType | ActivityType | SignalType

const canonicalSchemas = {
  account: Account,
  contact: Contact,
  opportunity: Opportunity,
  activity: Activity,
  signal: Signal,
} as const

/** Durable, client-scoped golden records. No delete operation exists by design. */
export class PostgresCanonicalStore {
  constructor(private readonly db: Queryable) {}

  async put(clientId: string, recordType: CanonicalRecordType, input: CanonicalRecord): Promise<CanonicalRecord> {
    assertClientId(clientId)
    const record = canonicalSchemas[recordType].parse(input) as CanonicalRecord
    if (record.clientId !== clientId) throw new Error(`record client ${record.clientId} does not match ${clientId}`)
    for (const [system, externalId] of Object.entries(record.externalIds)) {
      const existing = await this.findByExternalId(clientId, recordType, system, externalId)
      if (existing && existing.id !== record.id) {
        throw new Error(`${recordType} external id ${system}:${externalId} already belongs to ${existing.id}`)
      }
    }
    await this.db.query(
      `INSERT INTO canonical_records
         (client_id, record_type, record_id, external_ids, doc, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (client_id, record_type, record_id) DO UPDATE
         SET external_ids = EXCLUDED.external_ids, doc = EXCLUDED.doc, updated_at = EXCLUDED.updated_at`,
      [
        clientId,
        recordType,
        record.id,
        JSON.stringify(record.externalIds),
        JSON.stringify(record),
        record.createdAt,
        record.updatedAt,
      ],
    )
    return record
  }

  async get(clientId: string, recordType: CanonicalRecordType, recordId: string): Promise<CanonicalRecord | null> {
    assertClientId(clientId)
    const { rows } = await this.db.query(
      `SELECT doc FROM canonical_records
       WHERE client_id = $1 AND record_type = $2 AND record_id = $3`,
      [clientId, recordType, recordId],
    )
    return rows.length === 0 ? null : parseCanonical(recordType, (rows[0] as { doc: unknown }).doc)
  }

  async findByExternalId(
    clientId: string,
    recordType: CanonicalRecordType,
    system: string,
    externalId: string,
  ): Promise<CanonicalRecord | null> {
    assertClientId(clientId)
    if (!system.trim() || !externalId.trim()) throw new Error('external id system and value are required')
    const { rows } = await this.db.query(
      `SELECT doc FROM canonical_records
       WHERE client_id = $1 AND record_type = $2 AND external_ids @> $3::jsonb
       ORDER BY updated_at DESC LIMIT 1`,
      [clientId, recordType, JSON.stringify({ [system]: externalId })],
    )
    return rows.length === 0 ? null : parseCanonical(recordType, (rows[0] as { doc: unknown }).doc)
  }

  async list(clientId: string, recordType: CanonicalRecordType, limit = 500): Promise<CanonicalRecord[]> {
    assertClientId(clientId)
    if (!Number.isInteger(limit) || limit < 1 || limit > 5000) throw new Error('canonical list limit must be 1-5000')
    const { rows } = await this.db.query(
      `SELECT doc FROM canonical_records
       WHERE client_id = $1 AND record_type = $2
       ORDER BY updated_at DESC LIMIT $3`,
      [clientId, recordType, limit],
    )
    return rows.map((row) => parseCanonical(recordType, (row as { doc: unknown }).doc))
  }

  async listAll(clientId: string, recordType: CanonicalRecordType): Promise<CanonicalRecord[]> {
    assertClientId(clientId)
    const { rows } = await this.db.query(
      `SELECT doc FROM canonical_records
       WHERE client_id = $1 AND record_type = $2
       ORDER BY updated_at DESC`,
      [clientId, recordType],
    )
    return rows.map((row) => parseCanonical(recordType, (row as { doc: unknown }).doc))
  }

  async promoteAccounts(
    clientId: string,
    candidates: CanonicalCandidate[],
    options: PromotionOptions = {},
  ): Promise<PromotionResult<AccountType>> {
    const existing = await this.listAll(clientId, 'account') as AccountType[]
    const result = promoteAccountCandidates(clientId, candidates, existing, options)
    for (const record of result.changedRecords) await this.put(clientId, 'account', record)
    return result
  }

  async promoteContacts(
    clientId: string,
    candidates: CanonicalCandidate[],
    options: PromotionOptions = {},
  ): Promise<PromotionResult<ContactType>> {
    const [existing, accounts] = await Promise.all([
      this.listAll(clientId, 'contact') as Promise<ContactType[]>,
      this.listAll(clientId, 'account') as Promise<AccountType[]>,
    ])
    const result = promoteContactCandidates(clientId, candidates, existing, accounts, options)
    for (const record of result.changedRecords) await this.put(clientId, 'contact', record)
    return result
  }

  async promoteOpportunities(
    clientId: string,
    candidates: CanonicalCandidate[],
    options: PromotionOptions = {},
  ): Promise<PromotionResult<OpportunityType>> {
    const existing = await this.listAll(clientId, 'opportunity') as OpportunityType[]
    const result = promoteOpportunityCandidates(clientId, candidates, existing, options)
    for (const record of result.changedRecords) await this.put(clientId, 'opportunity', record)
    return result
  }

  async promoteActivities(
    clientId: string,
    candidates: CanonicalCandidate[],
    options: PromotionOptions = {},
  ): Promise<PromotionResult<ActivityType>> {
    const existing = await this.listAll(clientId, 'activity') as ActivityType[]
    const result = promoteActivityCandidates(clientId, candidates, existing, options)
    for (const record of result.changedRecords) await this.put(clientId, 'activity', record)
    return result
  }

  async closedLostRows(clientId: string): Promise<CanonicalClosedLostRow[]> {
    const [accounts, opportunities] = await Promise.all([
      this.listAll(clientId, 'account') as Promise<AccountType[]>,
      this.listAll(clientId, 'opportunity') as Promise<OpportunityType[]>,
    ])
    return canonicalClosedLostRows(accounts, opportunities)
  }

  async auditRows(clientId: string): Promise<{ accounts: AuditAccountRow[]; contacts: AuditContactRow[] }> {
    const [accounts, contacts] = await Promise.all([
      this.listAll(clientId, 'account') as Promise<AccountType[]>,
      this.listAll(clientId, 'contact') as Promise<ContactType[]>,
    ])
    return canonicalAuditRows(accounts, contacts)
  }
}

function stagedRow(row: unknown): StoredStagedBatch {
  const value = row as { batch_id: string; client_id: string; batch: unknown }
  return {
    batchId: value.batch_id,
    clientId: value.client_id,
    batch: StagedBatchSchema.parse(value.batch) as StagedBatch,
  }
}

function parseCanonical(recordType: CanonicalRecordType, value: unknown): CanonicalRecord {
  return canonicalSchemas[recordType].parse(value) as CanonicalRecord
}

function assertClientId(clientId: string): void {
  if (clientId.trim() === '') throw new Error('client id is required')
}

export class PostgresRunStore implements RunnerStore {
  constructor(private readonly db: Queryable) {}

  async get(runId: string): Promise<RunRecord | null> {
    const { rows } = await this.db.query('SELECT doc FROM runs WHERE run_id = $1', [runId])
    return rows.length > 0 ? ((rows[0] as { doc: RunRecord }).doc) : null
  }

  async getScoped(clientId: string, runId: string): Promise<RunRecord | null> {
    const { rows } = await this.db.query(
      'SELECT doc FROM runs WHERE client_id = $1 AND run_id = $2',
      [clientId, runId],
    )
    return rows.length > 0 ? ((rows[0] as { doc: RunRecord }).doc) : null
  }

  async save(run: RunRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO runs (run_id, client_id, pipeline_id, module_id, status, doc, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (run_id) DO UPDATE
         SET status = EXCLUDED.status, doc = EXCLUDED.doc, updated_at = EXCLUDED.updated_at`,
      [run.runId, run.clientId, run.pipelineId, run.moduleId, run.status, JSON.stringify(run), run.createdAt, run.updatedAt],
    )
  }

  async decideGate(input: GateDecisionInput): Promise<RunRecord> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await this.get(input.runId)
      if (!current) throw new Error(`run ${input.runId} not found`)
      const original = JSON.stringify(current)
      applyGateDecision(current, input)
      const { rows } = await this.db.query(
        `UPDATE runs SET status = $2, doc = $3, updated_at = $4
         WHERE run_id = $1 AND doc = $5::jsonb
         RETURNING doc`,
        [current.runId, current.status, JSON.stringify(current), current.updatedAt, original],
      )
      if (rows.length > 0) return (rows[0] as { doc: RunRecord }).doc
    }
    throw new Error(`run ${input.runId} changed while deciding gate ${input.gateId}`)
  }

  async list(clientId: string): Promise<RunRecord[]> {
    const { rows } = await this.db.query(
      'SELECT doc FROM runs WHERE client_id = $1 ORDER BY updated_at DESC',
      [clientId],
    )
    return rows.map((r) => (r as { doc: RunRecord }).doc)
  }

  async listByStatus(status: RunStatus): Promise<RunRecord[]> {
    const { rows } = await this.db.query('SELECT doc FROM runs WHERE status = $1', [status])
    return rows.map((r) => (r as { doc: RunRecord }).doc)
  }
}

export class PostgresCacheStore implements CacheStore {
  constructor(private readonly db: Queryable) {}

  async get(domain: string): Promise<CacheEntry | null> {
    const { rows } = await this.db.query('SELECT entry FROM enrichment_cache WHERE domain = $1', [domain])
    return rows.length > 0 ? ((rows[0] as { entry: CacheEntry }).entry) : null
  }

  async put(entry: CacheEntry): Promise<void> {
    await this.db.query(
      `INSERT INTO enrichment_cache (domain, entry, updated_at) VALUES ($1, $2, $3)
       ON CONFLICT (domain) DO UPDATE SET entry = EXCLUDED.entry, updated_at = EXCLUDED.updated_at`,
      [entry.domain, JSON.stringify(entry), entry.lastUpdatedAt],
    )
  }
}

export class PostgresFeedbackLog {
  constructor(private readonly db: Queryable) {}

  async append(event: FeedbackEvent): Promise<void> {
    await this.db.query(
      `INSERT INTO feedback_events (id, client_id, kind, occurred_at, event)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [event.id, event.clientId, event.kind, event.occurredAt, JSON.stringify(event)],
    )
  }

  async list(clientId: string, limit = 500): Promise<FeedbackEvent[]> {
    const { rows } = await this.db.query(
      'SELECT event FROM feedback_events WHERE client_id = $1 ORDER BY occurred_at DESC LIMIT $2',
      [clientId, limit],
    )
    return rows.map((r) => (r as { event: FeedbackEvent }).event)
  }
}
