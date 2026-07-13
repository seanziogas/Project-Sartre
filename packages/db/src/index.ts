import type { FeedbackEvent } from '@sartre/core'
import type { CacheEntry, CacheStore } from '@sartre/connectors'
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
  `)
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
