import { resolve } from 'node:path'
import { FileClientBrainStore, loadManifestsFromDir } from '@sartre/core'
import { createPostgresConnection, migrate, PostgresEffectLedger, PostgresRunStore, PostgresRuntimeArtifactStore, PostgresScheduleClaimStore, PostgresToolConnectionStore } from '@sartre/db'
import { Runner } from '@sartre/pipelines'
import { AnthropicLlmClient } from '@sartre/skills'
import { loadModuleDeps } from './deployment.js'
import { buildRegistry } from './registry.js'
import { TenantConnectionResolver } from './connections.js'
import { TenantToolClients } from './tools.js'
import { loadRunnerConfig } from './config.js'
import { ReadinessState, startHealthServer } from './health.js'
import { createOperationalLogger } from './operational-log.js'

/**
 * Runner service entrypoint. Config via env:
 *   SARTRE_CLIENTS_DIR  — client instances (default ../../clients)
 *   DATABASE_URL        — shared Postgres used by ops and runner (required)
 *   SARTRE_MODULE_DEPS  — optional deployment override; built-in adapter is the default
 *   SARTRE_CREDENTIAL_ENCRYPTION_KEY — required only when an adapter resolves a client connection
 *   SARTRE_TICK_MS      — tick interval (default 30000)
 *   SARTRE_HEALTH_PORT  — liveness/readiness HTTP port (default 3001)
 */
const config = loadRunnerConfig(process.env, resolve(import.meta.dirname, '../../..'))
const connection = createPostgresConnection(config.databaseUrl)
const llm = new AnthropicLlmClient('claude-opus-4-8')
const brains = new FileClientBrainStore(config.clientsDir)
const connections = new TenantConnectionResolver(
  new PostgresToolConnectionStore(connection),
  config.credentialKeys,
)
const tools = new TenantToolClients(connection, connections)
const artifacts = new PostgresRuntimeArtifactStore(connection)
const moduleDeps = await initializeModuleDeps()

async function initializeModuleDeps() {
  try {
    await migrate(connection)
    return await loadModuleDeps(config.moduleDeps, { db: connection, brains, connections, tools })
  } catch (error) {
    await connection.close()
    throw error
  }
}

const log = createOperationalLogger()
const readiness = new ReadinessState()
let consecutiveTickFailures = 0

const recordTickSuccess = (report: { resumed: unknown[]; scheduled: unknown[]; warnings: unknown[] }) => {
  consecutiveTickFailures = 0
  if (readiness.succeeded()) log('info', 'readiness_changed', { ready: true })
  log('info', 'tick_completed', {
    resumed: report.resumed.length, scheduled: report.scheduled.length, warnings: report.warnings.length,
  })
}

const recordTickFailure = (error: Error) => {
  consecutiveTickFailures++
  if (readiness.failed()) log('warn', 'readiness_changed', { ready: false })
  log('error', 'tick_failed', { message: error.message, consecutiveFailures: consecutiveTickFailures })
}

const runner = new Runner({
  store: new PostgresRunStore(connection),
  registry: buildRegistry(moduleDeps, llm),
  manifests: async () => {
    const { manifests, problems } = await loadManifestsFromDir(config.clientsDir)
    await Promise.all([...manifests].map(async ([clientId, manifest]) => {
      const runtimeMvd = await artifacts.get<typeof manifest.mvd>(clientId, 'mvd')
      if (runtimeMvd) manifest.mvd = runtimeMvd
    }))
    for (const p of problems) log('warn', 'manifest_invalid', { clientId: p.clientId, message: p.error })
    return manifests
  },
  onOperationalEvent: ({ event, fields }) => log('warn', event, fields),
  onTickComplete: recordTickSuccess,
  onTickError: recordTickFailure,
  scheduleClaims: new PostgresScheduleClaimStore(connection),
  effects: new PostgresEffectLedger(connection),
})

const healthServer = startHealthServer(config.healthPort, readiness.isReady)
log('info', 'runner_starting', {
  clientsDir: config.clientsDir, store: 'postgres', tickMs: config.tickMs, healthPort: config.healthPort,
})

let shutdownPromise: Promise<void> | null = null
const shutdown = (reason: string, exitCode = 0): Promise<void> => {
  if (shutdownPromise) return shutdownPromise
  shutdownPromise = (async () => {
    runner.stop()
    if (readiness.failed()) log('info', 'readiness_changed', { ready: false })
    if (healthServer.listening) {
      await new Promise<void>((resolveClose, reject) => healthServer.close((error) => error ? reject(error) : resolveClose()))
    }
    await connection.close()
    log('info', 'runner_stopped', { reason, exitCode })
    process.exitCode = exitCode
  })()
  return shutdownPromise
}

healthServer.on('error', (error) => {
  log('error', 'health_server_failed', { message: error.message })
  void shutdown('health_server_failure', 1)
})
process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))

// Immediate first tick, then interval. Startup stays unready until the tick succeeds.
try {
  const first = await runner.tick()
  recordTickSuccess(first)
  runner.start(config.tickMs)
} catch (error) {
  const normalized = error instanceof Error ? error : new Error(String(error))
  recordTickFailure(normalized)
  await shutdown('startup_failure', 1)
  throw normalized
}
