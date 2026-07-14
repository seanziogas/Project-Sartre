import { createHash, randomUUID } from 'node:crypto'
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
import type { CacheEntry, CacheStore, ConnectionAuthKind, ConnectorSnapshotStore, NamespacedWrite, StagedBatch, ToolConnectionEvent, ToolConnectionSummary } from '@sartre/connectors'
import {
  canonicalAuditRows,
  canonicalBriefContexts,
  canonicalClosedLostRows,
  canonicalDuplicateReviewGroups,
  promoteAccountCandidates,
  promoteActivityCandidates,
  promoteContactCandidates,
  promoteOpportunityCandidates,
} from '@sartre/data'
import type {
  AuditAccountRow,
  AuditContactRow,
  CanonicalClosedLostRow,
  CanonicalBriefContext,
  CanonicalCandidate,
  DuplicateReviewGroup,
  PromotionOptions,
  PromotionResult,
} from '@sartre/data'
import { applyGateDecision } from '@sartre/pipelines'
import type { GateDecisionInput, RunnerStore, RunRecord, RunStatus } from '@sartre/pipelines'
import { ConfigRelease, EvaluationRun, GovernancePolicy, GovernanceRequest } from '@sartre/operations'
import type { ConfigRelease as ConfigReleaseType, EvaluationRun as EvaluationRunType, GovernancePolicy as GovernancePolicyType, GovernanceRequest as GovernanceRequestType } from '@sartre/operations'
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

export interface TenantQueryable extends Queryable {
  queryTenant(clientId: string, sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>
  querySystem(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>
}

export interface PostgresConnection extends TenantQueryable {
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
    queryTenant: async (clientId, sql, params) => scopedPoolQuery(pool, 'sartre.client_id', clientId, sql, params),
    querySystem: async (sql, params) => scopedPoolQuery(pool, 'sartre.system_access', 'on', sql, params),
    close: async () => pool.end(),
  }
}

async function scopedPoolQuery(pool: Pool, setting: string, value: string, sql: string, params?: unknown[]) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`SELECT set_config('${setting}', $1, true)`, [value])
    const result = await client.query(sql, params)
    await client.query('COMMIT')
    return { rows: result.rows as unknown[] }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

function tenantQuery(db: Queryable, clientId: string, sql: string, params?: unknown[]) {
  assertClientId(clientId)
  return 'queryTenant' in db
    ? (db as TenantQueryable).queryTenant(clientId, sql, params)
    : db.query(sql, params)
}

function systemQuery(db: Queryable, sql: string, params?: unknown[]) {
  return 'querySystem' in db ? (db as TenantQueryable).querySystem(sql, params) : db.query(sql, params)
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

    CREATE TABLE IF NOT EXISTS tool_connections (
      client_id             text NOT NULL,
      connection_id         uuid NOT NULL,
      provider              text NOT NULL,
      auth_kind             text NOT NULL CHECK (auth_kind IN ('api_key', 'oauth', 'service_account')),
      label                 text NOT NULL,
      status                text NOT NULL CHECK (status IN ('active', 'revoked')),
      encrypted_credentials text NOT NULL,
      metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at            timestamptz NOT NULL,
      updated_at            timestamptz NOT NULL,
      PRIMARY KEY (client_id, connection_id)
    );
    CREATE INDEX IF NOT EXISTS tool_connections_client_idx
      ON tool_connections (client_id, status, provider, updated_at DESC);

    CREATE TABLE IF NOT EXISTS tool_connection_events (
      event_id       uuid PRIMARY KEY,
      connection_id  uuid NOT NULL,
      client_id      text NOT NULL,
      kind           text NOT NULL CHECK (kind IN ('connected', 'rotated', 'tested', 'revoked')),
      actor          text NOT NULL,
      detail         text NOT NULL,
      occurred_at    timestamptz NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tool_connection_events_client_idx
      ON tool_connection_events (client_id, occurred_at DESC);

    CREATE TABLE IF NOT EXISTS connector_snapshots (
      client_id    text NOT NULL,
      snapshot_id  uuid NOT NULL,
      provider     text NOT NULL,
      writes       jsonb NOT NULL,
      source_values jsonb NOT NULL,
      created_at   timestamptz NOT NULL,
      PRIMARY KEY (client_id, snapshot_id)
    );

    CREATE TABLE IF NOT EXISTS staged_batches (
      batch_id      text PRIMARY KEY,
      client_id     text NOT NULL,
      connector_id  text NOT NULL,
      object_type   text NOT NULL CHECK (object_type IN ('account', 'contact', 'opportunity', 'activity', 'lead', 'signal')),
      extracted_at timestamptz NOT NULL,
      cursor_value  text,
      batch         jsonb NOT NULL,
      created_at    timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS staged_client_idx
      ON staged_batches (client_id, connector_id, object_type, extracted_at DESC);
    ALTER TABLE staged_batches DROP CONSTRAINT IF EXISTS staged_batches_object_type_check;
    ALTER TABLE staged_batches ADD CONSTRAINT staged_batches_object_type_check
      CHECK (object_type IN ('account', 'contact', 'opportunity', 'activity', 'lead', 'signal'));

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

    CREATE TABLE IF NOT EXISTS runtime_artifacts (
      client_id  text NOT NULL,
      artifact_key text NOT NULL,
      value jsonb NOT NULL,
      updated_at timestamptz NOT NULL,
      PRIMARY KEY (client_id, artifact_key)
    );
    CREATE INDEX IF NOT EXISTS runtime_artifacts_client_idx
      ON runtime_artifacts (client_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS schedule_claims (
      client_id text NOT NULL,
      module_id text NOT NULL,
      minute_slot text NOT NULL,
      claimed_at timestamptz NOT NULL,
      PRIMARY KEY (client_id, module_id, minute_slot)
    );

    CREATE TABLE IF NOT EXISTS effect_claims (
      client_id text NOT NULL,
      idempotency_key text NOT NULL,
      payload_hash text NOT NULL,
      status text NOT NULL CHECK (status IN ('pending', 'completed')),
      receipt jsonb,
      created_at timestamptz NOT NULL,
      completed_at timestamptz,
      PRIMARY KEY (client_id, idempotency_key)
    );

    CREATE TABLE IF NOT EXISTS governance_policies (
      client_id text PRIMARY KEY,
      doc jsonb NOT NULL,
      updated_at timestamptz NOT NULL
    );

    CREATE TABLE IF NOT EXISTS governance_requests (
      client_id text NOT NULL,
      request_id uuid NOT NULL,
      kind text NOT NULL CHECK (kind IN ('export', 'restore', 'deletion', 'retention')),
      status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'executed')),
      doc jsonb NOT NULL,
      requested_at timestamptz NOT NULL,
      PRIMARY KEY (client_id, request_id)
    );
    CREATE INDEX IF NOT EXISTS governance_requests_client_idx ON governance_requests (client_id, requested_at DESC);

    CREATE TABLE IF NOT EXISTS config_releases (
      client_id text NOT NULL,
      release_id uuid NOT NULL,
      version integer NOT NULL,
      stage text NOT NULL CHECK (stage IN ('development', 'staging', 'production')),
      status text NOT NULL CHECK (status IN ('active', 'pending_approval', 'rejected', 'superseded')),
      doc jsonb NOT NULL,
      created_at timestamptz NOT NULL,
      PRIMARY KEY (client_id, release_id),
      UNIQUE (client_id, version)
    );
    CREATE INDEX IF NOT EXISTS config_releases_client_idx ON config_releases (client_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS evaluation_runs (
      client_id text NOT NULL,
      evaluation_id uuid NOT NULL,
      skill_id text NOT NULL,
      status text NOT NULL CHECK (status IN ('passed', 'failed')),
      doc jsonb NOT NULL,
      created_at timestamptz NOT NULL,
      PRIMARY KEY (client_id, evaluation_id)
    );
    CREATE INDEX IF NOT EXISTS evaluation_runs_client_idx ON evaluation_runs (client_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS portability_events (
      client_id text NOT NULL,
      event_id uuid NOT NULL,
      kind text NOT NULL CHECK (kind IN ('exported', 'restored', 'validated')),
      actor text NOT NULL,
      detail text NOT NULL,
      occurred_at timestamptz NOT NULL,
      PRIMARY KEY (client_id, event_id)
    );

    DO $rls$
    DECLARE table_name text;
    BEGIN
      FOREACH table_name IN ARRAY ARRAY[
        'runs', 'feedback_events', 'tool_connections', 'tool_connection_events',
        'connector_snapshots', 'staged_batches', 'canonical_records', 'runtime_artifacts',
        'schedule_claims', 'effect_claims', 'governance_policies', 'governance_requests',
        'config_releases', 'evaluation_runs', 'portability_events'
      ] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format('DROP POLICY IF EXISTS sartre_tenant_isolation ON %I', table_name);
        EXECUTE format(
          'CREATE POLICY sartre_tenant_isolation ON %I USING (client_id = current_setting(''sartre.client_id'', true) OR current_setting(''sartre.system_access'', true) = ''on'') WITH CHECK (client_id = current_setting(''sartre.client_id'', true) OR current_setting(''sartre.system_access'', true) = ''on'')',
          table_name
        );
      END LOOP;
    END $rls$;
  `)
}

/** Machine-owned per-client state such as health reports and current MVD results. */
export class PostgresRuntimeArtifactStore {
  constructor(private readonly db: Queryable) {}

  async put(clientId: string, key: string, value: unknown, updatedAt = new Date().toISOString()): Promise<void> {
    assertClientId(clientId)
    if (!key.trim()) throw new Error('runtime artifact key is required')
    await tenantQuery(this.db, clientId,
      `INSERT INTO runtime_artifacts (client_id, artifact_key, value, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (client_id, artifact_key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
      [clientId, key, JSON.stringify(value), updatedAt],
    )
  }

  async get<T>(clientId: string, key: string): Promise<T | null> {
    assertClientId(clientId)
    const { rows } = await tenantQuery(this.db, clientId,
      'SELECT value FROM runtime_artifacts WHERE client_id = $1 AND artifact_key = $2',
      [clientId, key],
    )
    return rows.length === 0 ? null : (rows[0] as { value: T }).value
  }

  async listPrefix<T>(clientId: string, prefix: string, limit = 500): Promise<Array<{ key: string; value: T; updatedAt: string }>> {
    assertClientId(clientId)
    if (!prefix || !Number.isInteger(limit) || limit < 1 || limit > 2_000) throw new Error('artifact prefix and limit are required')
    const { rows } = await tenantQuery(this.db, clientId,
      `SELECT artifact_key, value, updated_at FROM runtime_artifacts
       WHERE client_id = $1 AND artifact_key LIKE $2 ORDER BY updated_at DESC LIMIT $3`,
      [clientId, `${prefix.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`, limit],
    )
    return rows.map((row) => {
      const value = row as { artifact_key: string; value: T; updated_at: string | Date }
      return { key: value.artifact_key, value: value.value, updatedAt: asIsoTimestamp(value.updated_at) }
    })
  }
}

export interface StoredStagedBatch {
  batchId: string
  clientId: string
  batch: StagedBatch
}

export interface StoredToolConnection extends ToolConnectionSummary {
  encryptedCredentials: string
}

/** Tenant-scoped opaque credential storage. Encryption/decryption stays outside the DB adapter. */
export class PostgresToolConnectionStore {
  constructor(private readonly db: Queryable) {}

  async put(input: StoredToolConnection): Promise<ToolConnectionSummary> {
    assertClientId(input.clientId)
    if (!input.connectionId || !input.provider.trim() || !input.label.trim() || !input.encryptedCredentials) {
      throw new Error('connection id, provider, label, and encrypted credentials are required')
    }
    await tenantQuery(this.db, input.clientId,
      `INSERT INTO tool_connections
         (client_id, connection_id, provider, auth_kind, label, status, encrypted_credentials, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (client_id, connection_id) DO UPDATE SET
         provider = EXCLUDED.provider, auth_kind = EXCLUDED.auth_kind, label = EXCLUDED.label,
         status = EXCLUDED.status, encrypted_credentials = EXCLUDED.encrypted_credentials,
         metadata = EXCLUDED.metadata, updated_at = EXCLUDED.updated_at`,
      [input.clientId, input.connectionId, input.provider, input.authKind, input.label, input.status,
        input.encryptedCredentials, JSON.stringify(input.metadata), input.createdAt, input.updatedAt],
    )
    return connectionSummary(input)
  }

  async get(clientId: string, connectionId: string): Promise<StoredToolConnection | null> {
    assertClientId(clientId)
    const { rows } = await tenantQuery(this.db, clientId,
      `SELECT client_id, connection_id, provider, auth_kind, label, status, encrypted_credentials, metadata, created_at, updated_at
       FROM tool_connections WHERE client_id = $1 AND connection_id = $2`,
      [clientId, connectionId],
    )
    return rows.length === 0 ? null : storedConnection(rows[0])
  }

  async list(clientId: string, includeRevoked = false): Promise<ToolConnectionSummary[]> {
    assertClientId(clientId)
    const { rows } = await tenantQuery(this.db, clientId,
      `SELECT client_id, connection_id, provider, auth_kind, label, status, metadata, created_at, updated_at
       FROM tool_connections WHERE client_id = $1 AND ($2::boolean OR status = 'active')
       ORDER BY provider, updated_at DESC`,
      [clientId, includeRevoked],
    )
    return rows.map(connectionSummaryRow)
  }

  async revoke(clientId: string, connectionId: string, revokedAt: string): Promise<boolean> {
    assertClientId(clientId)
    const { rows } = await tenantQuery(this.db, clientId,
      `UPDATE tool_connections SET status = 'revoked', encrypted_credentials = '', updated_at = $3
       WHERE client_id = $1 AND connection_id = $2 AND status = 'active' RETURNING connection_id`,
      [clientId, connectionId, revokedAt],
    )
    return rows.length > 0
  }
}

export class PostgresToolConnectionEventStore {
  constructor(private readonly db: Queryable) {}

  async append(event: ToolConnectionEvent): Promise<void> {
    assertClientId(event.clientId)
    if (!event.actor.trim()) throw new Error('connection event actor is required')
    await tenantQuery(this.db, event.clientId,
      `INSERT INTO tool_connection_events (event_id, connection_id, client_id, kind, actor, detail, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (event_id) DO NOTHING`,
      [event.eventId, event.connectionId, event.clientId, event.kind, event.actor, event.detail, event.occurredAt],
    )
  }

  async list(clientId: string, limit = 100): Promise<ToolConnectionEvent[]> {
    assertClientId(clientId)
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('connection event limit must be 1-500')
    const { rows } = await tenantQuery(this.db, clientId,
      `SELECT event_id, connection_id, client_id, kind, actor, detail, occurred_at
       FROM tool_connection_events WHERE client_id = $1 ORDER BY occurred_at DESC LIMIT $2`,
      [clientId, limit],
    )
    return rows.map((row) => {
      const value = row as {
        event_id: string; connection_id: string; client_id: string; kind: ToolConnectionEvent['kind'];
        actor: string; detail: string; occurred_at: string | Date
      }
      return {
        eventId: value.event_id, connectionId: value.connection_id, clientId: value.client_id,
        kind: value.kind, actor: value.actor, detail: value.detail, occurredAt: asIsoTimestamp(value.occurred_at),
      }
    })
  }
}

export class PostgresConnectorSnapshotStore implements ConnectorSnapshotStore {
  constructor(private readonly db: Queryable, private readonly clientId: string) { assertClientId(clientId) }

  async capture(provider: string, writes: NamespacedWrite[], sourceValues: unknown[]): Promise<string> {
    if (!provider.trim() || writes.length !== sourceValues.length) throw new Error('snapshot provider and aligned source values are required')
    const snapshotId = randomUUID()
    await tenantQuery(this.db, this.clientId,
      `INSERT INTO connector_snapshots (client_id, snapshot_id, provider, writes, source_values, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [this.clientId, snapshotId, provider, JSON.stringify(writes), JSON.stringify(sourceValues), new Date().toISOString()],
    )
    return snapshotId
  }

  async exists(provider: string, snapshotRef: string): Promise<boolean> {
    const { rows } = await tenantQuery(this.db, this.clientId,
      `SELECT snapshot_id FROM connector_snapshots WHERE client_id = $1 AND provider = $2 AND snapshot_id = $3`,
      [this.clientId, provider, snapshotRef],
    )
    return rows.length > 0
  }
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
    await tenantQuery(this.db, clientId,
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
    const { rows } = await tenantQuery(this.db, clientId,
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
    const { rows } = await tenantQuery(this.db, clientId,
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
    await tenantQuery(this.db, clientId,
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
    const { rows } = await tenantQuery(this.db, clientId,
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
    const { rows } = await tenantQuery(this.db, clientId,
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
    const { rows } = await tenantQuery(this.db, clientId,
      `SELECT doc FROM canonical_records
       WHERE client_id = $1 AND record_type = $2
       ORDER BY updated_at DESC LIMIT $3`,
      [clientId, recordType, limit],
    )
    return rows.map((row) => parseCanonical(recordType, (row as { doc: unknown }).doc))
  }

  async listAll(clientId: string, recordType: CanonicalRecordType): Promise<CanonicalRecord[]> {
    assertClientId(clientId)
    const { rows } = await tenantQuery(this.db, clientId,
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

  /** Persist already-reviewed signals; validation and tenancy remain enforced here. */
  async putSignals(clientId: string, signals: SignalType[]): Promise<SignalType[]> {
    const stored: SignalType[] = []
    for (const signal of signals) {
      stored.push(await this.put(clientId, 'signal', signal) as SignalType)
    }
    return stored
  }

  async closedLostRows(clientId: string): Promise<CanonicalClosedLostRow[]> {
    const [accounts, opportunities] = await Promise.all([
      this.listAll(clientId, 'account') as Promise<AccountType[]>,
      this.listAll(clientId, 'opportunity') as Promise<OpportunityType[]>,
    ])
    return canonicalClosedLostRows(accounts, opportunities)
  }

  async briefContexts(clientId: string): Promise<CanonicalBriefContext[]> {
    const [accounts, contacts, opportunities, activities, signals] = await Promise.all([
      this.listAll(clientId, 'account') as Promise<AccountType[]>,
      this.listAll(clientId, 'contact') as Promise<ContactType[]>,
      this.listAll(clientId, 'opportunity') as Promise<OpportunityType[]>,
      this.listAll(clientId, 'activity') as Promise<ActivityType[]>,
      this.listAll(clientId, 'signal') as Promise<SignalType[]>,
    ])
    return canonicalBriefContexts(accounts, contacts, opportunities, activities, signals)
  }

  async duplicateReviewGroups(clientId: string): Promise<DuplicateReviewGroup[]> {
    const [accounts, contacts] = await Promise.all([
      this.listAll(clientId, 'account') as Promise<AccountType[]>,
      this.listAll(clientId, 'contact') as Promise<ContactType[]>,
    ])
    return canonicalDuplicateReviewGroups(accounts, contacts)
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

function storedConnection(row: unknown): StoredToolConnection {
  const value = row as {
    encrypted_credentials: string
  }
  return {
    ...connectionSummaryRow(row),
    encryptedCredentials: value.encrypted_credentials,
  }
}

function connectionSummaryRow(row: unknown): ToolConnectionSummary {
  const value = row as {
    client_id: string
    connection_id: string
    provider: string
    auth_kind: ConnectionAuthKind
    label: string
    status: 'active' | 'revoked'
    metadata: Record<string, string> | null
    created_at: string | Date
    updated_at: string | Date
  }
  return {
    connectionId: value.connection_id,
    clientId: value.client_id,
    provider: value.provider,
    authKind: value.auth_kind,
    label: value.label,
    status: value.status,
    metadata: value.metadata ?? {},
    createdAt: asIsoTimestamp(value.created_at),
    updatedAt: asIsoTimestamp(value.updated_at),
  }
}

function connectionSummary(connection: StoredToolConnection): ToolConnectionSummary {
  const { encryptedCredentials: _encryptedCredentials, ...summary } = connection
  return summary
}

function asIsoTimestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
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
    const { rows } = await systemQuery(this.db, 'SELECT doc FROM runs WHERE run_id = $1', [runId])
    return rows.length > 0 ? ((rows[0] as { doc: RunRecord }).doc) : null
  }

  async getScoped(clientId: string, runId: string): Promise<RunRecord | null> {
    const { rows } = await tenantQuery(this.db, clientId,
      'SELECT doc FROM runs WHERE client_id = $1 AND run_id = $2',
      [clientId, runId],
    )
    return rows.length > 0 ? ((rows[0] as { doc: RunRecord }).doc) : null
  }

  async save(run: RunRecord): Promise<void> {
    await tenantQuery(this.db, run.clientId,
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
      const { rows } = await tenantQuery(this.db, current.clientId,
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
    const { rows } = await tenantQuery(this.db, clientId,
      'SELECT doc FROM runs WHERE client_id = $1 ORDER BY updated_at DESC',
      [clientId],
    )
    return rows.map((r) => (r as { doc: RunRecord }).doc)
  }

  async listByStatus(status: RunStatus): Promise<RunRecord[]> {
    const { rows } = await systemQuery(this.db, 'SELECT doc FROM runs WHERE status = $1', [status])
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
    await tenantQuery(this.db, event.clientId,
      `INSERT INTO feedback_events (id, client_id, kind, occurred_at, event)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [event.id, event.clientId, event.kind, event.occurredAt, JSON.stringify(event)],
    )
  }

  async list(clientId: string, limit = 500): Promise<FeedbackEvent[]> {
    const { rows } = await tenantQuery(this.db, clientId,
      'SELECT event FROM feedback_events WHERE client_id = $1 ORDER BY occurred_at DESC LIMIT $2',
      [clientId, limit],
    )
    return rows.map((r) => (r as { event: FeedbackEvent }).event)
  }
}

/** Durable once-per-minute schedule claims shared by every runner replica. */
export class PostgresScheduleClaimStore {
  constructor(private readonly db: Queryable) {}

  async claim(clientId: string, moduleId: string, minuteSlot: string, claimedAt = new Date().toISOString()): Promise<boolean> {
    assertClientId(clientId)
    if (!moduleId.trim() || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(minuteSlot)) throw new Error('module id and UTC minute slot are required')
    const { rows } = await tenantQuery(this.db, clientId,
      `INSERT INTO schedule_claims (client_id, module_id, minute_slot, claimed_at)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING minute_slot`,
      [clientId, moduleId, minuteSlot, claimedAt],
    )
    return rows.length === 1
  }
}

/**
 * Durable effect ledger. A pending claim is deliberately not replayed: it may
 * represent a provider effect whose response was lost and requires review.
 */
export class PostgresEffectLedger {
  constructor(private readonly db: Queryable) {}

  async execute<T>(clientId: string, idempotencyKey: string, payload: unknown, perform: () => Promise<T>): Promise<T> {
    assertClientId(clientId)
    if (!idempotencyKey.trim()) throw new Error('effect idempotency key is required')
    const payloadHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex')
    const createdAt = new Date().toISOString()
    const { rows: claimed } = await tenantQuery(this.db, clientId,
      `INSERT INTO effect_claims (client_id, idempotency_key, payload_hash, status, created_at)
       VALUES ($1, $2, $3, 'pending', $4) ON CONFLICT DO NOTHING RETURNING idempotency_key`,
      [clientId, idempotencyKey, payloadHash, createdAt],
    )
    if (claimed.length === 0) {
      const { rows } = await tenantQuery(this.db, clientId,
        `SELECT payload_hash, status, receipt FROM effect_claims WHERE client_id = $1 AND idempotency_key = $2`,
        [clientId, idempotencyKey],
      )
      const existing = rows[0] as { payload_hash: string; status: 'pending' | 'completed'; receipt: T | null } | undefined
      if (!existing) throw new Error('effect claim disappeared')
      if (existing.payload_hash !== payloadHash) throw new Error(`effect idempotency key ${idempotencyKey} was reused with different payload`)
      if (existing.status === 'completed') return existing.receipt as T
      throw new Error(`effect ${idempotencyKey} is pending reconciliation and will not be replayed`)
    }
    const receipt = await perform()
    await tenantQuery(this.db, clientId,
      `UPDATE effect_claims SET status = 'completed', receipt = $3, completed_at = $4
       WHERE client_id = $1 AND idempotency_key = $2 AND status = 'pending'`,
      [clientId, idempotencyKey, JSON.stringify(receipt), new Date().toISOString()],
    )
    return receipt
  }
}

export class PostgresGovernanceStore {
  constructor(private readonly db: Queryable) {}

  async putPolicy(policy: GovernancePolicyType): Promise<void> {
    const parsed = GovernancePolicy.parse(policy)
    await tenantQuery(this.db, parsed.clientId,
      `INSERT INTO governance_policies (client_id, doc, updated_at) VALUES ($1, $2, $3)
       ON CONFLICT (client_id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = EXCLUDED.updated_at`,
      [parsed.clientId, JSON.stringify(parsed), parsed.updatedAt],
    )
  }

  async getPolicy(clientId: string): Promise<GovernancePolicyType | null> {
    const { rows } = await tenantQuery(this.db, clientId, 'SELECT doc FROM governance_policies WHERE client_id = $1', [clientId])
    return rows.length ? GovernancePolicy.parse((rows[0] as { doc: unknown }).doc) : null
  }

  async putRequest(request: GovernanceRequestType): Promise<void> {
    const parsed = GovernanceRequest.parse(request)
    await tenantQuery(this.db, parsed.clientId,
      `INSERT INTO governance_requests (client_id, request_id, kind, status, doc, requested_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (client_id, request_id) DO UPDATE SET status = EXCLUDED.status, doc = EXCLUDED.doc`,
      [parsed.clientId, parsed.requestId, parsed.kind, parsed.status, JSON.stringify(parsed), parsed.requestedAt],
    )
  }

  async getRequest(clientId: string, requestId: string): Promise<GovernanceRequestType | null> {
    const { rows } = await tenantQuery(this.db, clientId,
      'SELECT doc FROM governance_requests WHERE client_id = $1 AND request_id = $2', [clientId, requestId])
    return rows.length ? GovernanceRequest.parse((rows[0] as { doc: unknown }).doc) : null
  }

  async listRequests(clientId: string): Promise<GovernanceRequestType[]> {
    const { rows } = await tenantQuery(this.db, clientId,
      'SELECT doc FROM governance_requests WHERE client_id = $1 ORDER BY requested_at DESC', [clientId])
    return rows.map((row) => GovernanceRequest.parse((row as { doc: unknown }).doc))
  }

  /** Executes only the database portion of an already approved retention/deletion request. */
  async deleteBefore(clientId: string, category: string, cutoff: string): Promise<number> {
    const targets: Record<string, Array<{ table: string; time: string }>> = {
      runs: [{ table: 'runs', time: 'updated_at' }], feedback: [{ table: 'feedback_events', time: 'occurred_at' }],
      connections: [{ table: 'tool_connections', time: 'updated_at' }, { table: 'connector_snapshots', time: 'created_at' }],
      staging: [{ table: 'staged_batches', time: 'created_at' }], canonical: [{ table: 'canonical_records', time: 'updated_at' }],
      artifacts: [{ table: 'runtime_artifacts', time: 'updated_at' }], effects: [{ table: 'effect_claims', time: 'created_at' }, { table: 'schedule_claims', time: 'claimed_at' }],
      configuration: [{ table: 'config_releases', time: 'created_at' }], evaluations: [{ table: 'evaluation_runs', time: 'created_at' }],
      audit: [{ table: 'tool_connection_events', time: 'occurred_at' }, { table: 'portability_events', time: 'occurred_at' }],
    }
    const categoryTargets = targets[category]
    if (!categoryTargets) throw new Error(`database retention is not supported for ${category}`)
    let deleted = 0
    for (const target of categoryTargets) {
      const { rows } = await tenantQuery(this.db, clientId,
        `DELETE FROM ${target.table} WHERE client_id = $1 AND ${target.time} < $2 RETURNING client_id`, [clientId, cutoff])
      deleted += rows.length
    }
    return deleted
  }
}

export class PostgresConfigReleaseStore {
  constructor(private readonly db: Queryable) {}

  async nextVersion(clientId: string): Promise<number> {
    const { rows } = await tenantQuery(this.db, clientId, 'SELECT COALESCE(MAX(version), 0) + 1 AS version FROM config_releases WHERE client_id = $1', [clientId])
    return Number((rows[0] as { version: number | string }).version)
  }

  async put(release: ConfigReleaseType): Promise<void> {
    const parsed = ConfigRelease.parse(release)
    if (parsed.status === 'active') {
      await tenantQuery(this.db, parsed.clientId,
        `UPDATE config_releases SET status = 'superseded', doc = jsonb_set(doc, '{status}', '"superseded"'::jsonb)
         WHERE client_id = $1 AND stage = $2 AND status = 'active' AND release_id <> $3`,
        [parsed.clientId, parsed.stage, parsed.releaseId])
    }
    await tenantQuery(this.db, parsed.clientId,
      `INSERT INTO config_releases (client_id, release_id, version, stage, status, doc, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (client_id, release_id) DO UPDATE SET stage = EXCLUDED.stage, status = EXCLUDED.status, doc = EXCLUDED.doc`,
      [parsed.clientId, parsed.releaseId, parsed.version, parsed.stage, parsed.status, JSON.stringify(parsed), parsed.createdAt],
    )
  }

  async get(clientId: string, releaseId: string): Promise<ConfigReleaseType | null> {
    const { rows } = await tenantQuery(this.db, clientId, 'SELECT doc FROM config_releases WHERE client_id = $1 AND release_id = $2', [clientId, releaseId])
    return rows.length ? ConfigRelease.parse((rows[0] as { doc: unknown }).doc) : null
  }

  async list(clientId: string): Promise<ConfigReleaseType[]> {
    const { rows } = await tenantQuery(this.db, clientId, 'SELECT doc FROM config_releases WHERE client_id = $1 ORDER BY version DESC', [clientId])
    return rows.map((row) => ConfigRelease.parse((row as { doc: unknown }).doc))
  }
}

export class PostgresEvaluationRunStore {
  constructor(private readonly db: Queryable) {}

  async append(evaluation: EvaluationRunType): Promise<void> {
    const parsed = EvaluationRun.parse(evaluation)
    await tenantQuery(this.db, parsed.clientId,
      `INSERT INTO evaluation_runs (client_id, evaluation_id, skill_id, status, doc, created_at)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (client_id, evaluation_id) DO NOTHING`,
      [parsed.clientId, parsed.evaluationId, parsed.skillId, parsed.status, JSON.stringify(parsed), parsed.createdAt],
    )
  }

  async list(clientId: string, limit = 500): Promise<EvaluationRunType[]> {
    const { rows } = await tenantQuery(this.db, clientId,
      'SELECT doc FROM evaluation_runs WHERE client_id = $1 ORDER BY created_at DESC LIMIT $2', [clientId, limit])
    return rows.map((row) => EvaluationRun.parse((row as { doc: unknown }).doc))
  }
}

export interface PortabilityAuditEvent { eventId: string; clientId: string; kind: 'exported' | 'restored' | 'validated'; actor: string; detail: string; occurredAt: string }

export class PostgresPortabilityStore {
  constructor(private readonly db: Queryable) {}

  async audit(event: PortabilityAuditEvent): Promise<void> {
    assertClientId(event.clientId)
    await tenantQuery(this.db, event.clientId,
      `INSERT INTO portability_events (client_id, event_id, kind, actor, detail, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
      [event.clientId, event.eventId, event.kind, event.actor, event.detail, event.occurredAt])
  }

  async listAudit(clientId: string): Promise<PortabilityAuditEvent[]> {
    const { rows } = await tenantQuery(this.db, clientId,
      'SELECT event_id, client_id, kind, actor, detail, occurred_at FROM portability_events WHERE client_id = $1 ORDER BY occurred_at DESC', [clientId])
    return rows.map((row) => {
      const value = row as { event_id: string; client_id: string; kind: PortabilityAuditEvent['kind']; actor: string; detail: string; occurred_at: string | Date }
      return { eventId: value.event_id, clientId: value.client_id, kind: value.kind, actor: value.actor, detail: value.detail, occurredAt: asIsoTimestamp(value.occurred_at) }
    })
  }

  /** Credential envelopes are intentionally absent. */
  async exportRecords(clientId: string): Promise<Array<{ category: string; rows: unknown[] }>> {
    const queries: Array<[string, string]> = [
      ['runs', 'SELECT doc FROM runs WHERE client_id = $1 ORDER BY created_at'],
      ['feedback', 'SELECT event AS doc FROM feedback_events WHERE client_id = $1 ORDER BY occurred_at'],
      ['staging', 'SELECT batch AS doc FROM staged_batches WHERE client_id = $1 ORDER BY created_at'],
      ['canonical', "SELECT jsonb_build_object('recordType', record_type, 'record', doc) AS doc FROM canonical_records WHERE client_id = $1 ORDER BY created_at"],
      ['artifacts', "SELECT jsonb_build_object('key', artifact_key, 'value', value, 'updatedAt', updated_at) AS doc FROM runtime_artifacts WHERE client_id = $1 ORDER BY updated_at"],
      ['connection-audit', "SELECT jsonb_build_object('eventId', event_id, 'connectionId', connection_id, 'clientId', client_id, 'kind', kind, 'actor', actor, 'detail', detail, 'occurredAt', occurred_at) AS doc FROM tool_connection_events WHERE client_id = $1 ORDER BY occurred_at"],
      ['snapshots', "SELECT jsonb_build_object('snapshotId', snapshot_id, 'provider', provider, 'writes', writes, 'sourceValues', source_values, 'createdAt', created_at) AS doc FROM connector_snapshots WHERE client_id = $1 ORDER BY created_at"],
      ['effects', "SELECT jsonb_build_object('idempotencyKey', idempotency_key, 'payloadHash', payload_hash, 'status', status, 'receipt', receipt, 'createdAt', created_at, 'completedAt', completed_at) AS doc FROM effect_claims WHERE client_id = $1 ORDER BY created_at"],
      ['configuration', 'SELECT doc FROM config_releases WHERE client_id = $1 ORDER BY version'],
      ['evaluations', 'SELECT doc FROM evaluation_runs WHERE client_id = $1 ORDER BY created_at'],
      ['audit', "SELECT jsonb_build_object('eventId', event_id, 'clientId', client_id, 'kind', kind, 'actor', actor, 'detail', detail, 'occurredAt', occurred_at) AS doc FROM portability_events WHERE client_id = $1 ORDER BY occurred_at"],
    ]
    const output = []
    for (const [category, sql] of queries) {
      const { rows } = await tenantQuery(this.db, clientId, sql, [clientId])
      output.push({ category, rows: rows.map((row) => (row as { doc: unknown }).doc) })
    }
    return output
  }

  async restoreRecords(clientId: string, categories: Array<{ category: string; rows: unknown[] }>): Promise<Record<string, number>> {
    assertClientId(clientId)
    await this.assertRestoreTargetEmpty(clientId)
    const counts: Record<string, number> = {}
    for (const category of categories) {
      if (category.category === 'runs') {
        const store = new PostgresRunStore(this.db)
        for (const row of category.rows) {
          const run = row as RunRecord
          if (run.clientId !== clientId) throw new Error('run client does not match portability target')
          await store.save(run)
        }
      } else if (category.category === 'feedback') {
        const store = new PostgresFeedbackLog(this.db)
        for (const row of category.rows) {
          const event = row as FeedbackEvent
          if (event.clientId !== clientId) throw new Error('feedback client does not match portability target')
          await store.append(event)
        }
      } else if (category.category === 'staging') {
        const store = new PostgresStagingStore(this.db)
        for (const row of category.rows) await store.append(clientId, StagedBatchSchema.parse(row) as StagedBatch)
      } else if (category.category === 'canonical') {
        const store = new PostgresCanonicalStore(this.db)
        for (const row of category.rows) {
          const value = row as { recordType: CanonicalRecordType; record: CanonicalRecord }
          if (!Object.hasOwn(canonicalSchemas, value.recordType)) throw new Error('invalid canonical record type in portability bundle')
          await store.put(clientId, value.recordType, value.record)
        }
      } else if (category.category === 'artifacts') {
        const store = new PostgresRuntimeArtifactStore(this.db)
        for (const row of category.rows) {
          const value = row as { key: string; value: unknown; updatedAt: string }
          await store.put(clientId, value.key, value.value, asIsoTimestamp(value.updatedAt))
        }
      } else if (category.category === 'connection-audit') {
        const store = new PostgresToolConnectionEventStore(this.db)
        for (const row of category.rows) {
          const event = row as ToolConnectionEvent
          if (event.clientId !== clientId) throw new Error('connection audit client does not match portability target')
          await store.append(event)
        }
      } else if (category.category === 'snapshots') {
        for (const row of category.rows) {
          const value = row as { snapshotId: string; provider: string; writes: unknown; sourceValues: unknown; createdAt: string }
          await tenantQuery(this.db, clientId,
            `INSERT INTO connector_snapshots (client_id, snapshot_id, provider, writes, source_values, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
            [clientId, value.snapshotId, value.provider, JSON.stringify(value.writes), JSON.stringify(value.sourceValues), value.createdAt])
        }
      } else if (category.category === 'effects') {
        for (const row of category.rows) {
          const value = row as { idempotencyKey: string; payloadHash: string; status: string; receipt: unknown; createdAt: string; completedAt: string | null }
          await tenantQuery(this.db, clientId,
            `INSERT INTO effect_claims (client_id, idempotency_key, payload_hash, status, receipt, created_at, completed_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [clientId, value.idempotencyKey, value.payloadHash, value.status, value.receipt === null ? null : JSON.stringify(value.receipt), value.createdAt, value.completedAt])
        }
      } else if (category.category === 'configuration') {
        const store = new PostgresConfigReleaseStore(this.db)
        for (const row of category.rows) {
          const release = ConfigRelease.parse(row)
          if (release.clientId !== clientId) throw new Error('configuration client does not match portability target')
          await store.put(release)
        }
      } else if (category.category === 'evaluations') {
        const store = new PostgresEvaluationRunStore(this.db)
        for (const row of category.rows) {
          const evaluation = EvaluationRun.parse(row)
          if (evaluation.clientId !== clientId) throw new Error('evaluation client does not match portability target')
          await store.append(evaluation)
        }
      } else if (category.category === 'audit') {
        for (const row of category.rows) {
          const event = row as PortabilityAuditEvent
          if (event.clientId !== clientId) throw new Error('portability audit client does not match target')
          await this.audit(event)
        }
      } else {
        throw new Error(`unsupported portability category ${category.category}`)
      }
      counts[category.category] = category.rows.length
    }
    return counts
  }

  async assertRestoreTargetEmpty(clientId: string): Promise<void> {
    assertClientId(clientId)
    for (const table of portableTables) {
      const { rows } = await tenantQuery(this.db, clientId, `SELECT COUNT(*) AS count FROM ${table} WHERE client_id = $1`, [clientId])
      if (Number((rows[0] as { count: number | string }).count) > 0) throw new Error(`restore target ${clientId} is not empty (${table})`)
    }
  }

  /** Compensating cleanup for a failed restore into a target proven empty immediately beforehand. */
  async clearPortableData(clientId: string): Promise<void> {
    assertClientId(clientId)
    for (const table of portableTables) await tenantQuery(this.db, clientId, `DELETE FROM ${table} WHERE client_id = $1`, [clientId])
  }
}

const portableTables = [
  'runs', 'feedback_events', 'staged_batches', 'canonical_records', 'runtime_artifacts', 'tool_connection_events',
  'connector_snapshots', 'effect_claims', 'config_releases', 'evaluation_runs',
] as const
