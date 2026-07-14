import 'server-only'
import {
  createPostgresConnection,
  migrate,
  PostgresFeedbackLog,
  PostgresConfigReleaseStore,
  PostgresEvaluationRunStore,
  PostgresGovernanceStore,
  PostgresPortabilityStore,
  PostgresRunStore,
  PostgresRuntimeArtifactStore,
  PostgresToolConnectionStore,
  PostgresToolConnectionEventStore,
} from '@sartre/db'
import { OpsRunData } from './run-data'

interface OpsDatabase {
  data: OpsRunData
  connections: PostgresToolConnectionStore
  connectionEvents: PostgresToolConnectionEventStore
  artifacts: PostgresRuntimeArtifactStore
  governance: PostgresGovernanceStore
  configReleases: PostgresConfigReleaseStore
  evaluations: PostgresEvaluationRunStore
  portability: PostgresPortabilityStore
  health(): Promise<void>
}

const globalDatabase = globalThis as typeof globalThis & {
  sartreOpsDatabase?: Promise<OpsDatabase>
}

export function getOpsDatabase(): Promise<OpsDatabase> {
  globalDatabase.sartreOpsDatabase ??= initialize()
  return globalDatabase.sartreOpsDatabase
}

async function initialize(): Promise<OpsDatabase> {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the ops app')
  const connection = createPostgresConnection(databaseUrl)
  try {
    await migrate(connection)
    return {
      data: new OpsRunData(new PostgresRunStore(connection), new PostgresFeedbackLog(connection)),
      connections: new PostgresToolConnectionStore(connection),
      connectionEvents: new PostgresToolConnectionEventStore(connection),
      artifacts: new PostgresRuntimeArtifactStore(connection),
      governance: new PostgresGovernanceStore(connection),
      configReleases: new PostgresConfigReleaseStore(connection),
      evaluations: new PostgresEvaluationRunStore(connection),
      portability: new PostgresPortabilityStore(connection),
      health: async () => { await connection.query('SELECT 1') },
    }
  } catch (error) {
    await connection.close()
    throw error
  }
}
