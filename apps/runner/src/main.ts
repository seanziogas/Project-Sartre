import { resolve } from 'node:path'
import { FileClientBrainStore, loadManifestsFromDir } from '@sartre/core'
import { createPostgresConnection, migrate, PostgresRunStore, PostgresRuntimeArtifactStore, PostgresToolConnectionStore } from '@sartre/db'
import { Runner } from '@sartre/pipelines'
import { AnthropicLlmClient } from '@sartre/skills'
import { loadModuleDeps } from './deployment.js'
import { buildRegistry } from './registry.js'
import { TenantConnectionResolver } from './connections.js'
import { TenantToolClients } from './tools.js'
import { loadRunnerConfig } from './config.js'
import { startHealthServer } from './health.js'

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
  config.encryptionKey,
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

const log = (msg: string) => console.log(`[runner ${new Date().toISOString()}] ${msg}`)

const runner = new Runner({
  store: new PostgresRunStore(connection),
  registry: buildRegistry(moduleDeps, llm),
  manifests: async () => {
    const { manifests, problems } = await loadManifestsFromDir(config.clientsDir)
    await Promise.all([...manifests].map(async ([clientId, manifest]) => {
      const runtimeMvd = await artifacts.get<typeof manifest.mvd>(clientId, 'mvd')
      if (runtimeMvd) manifest.mvd = runtimeMvd
    }))
    for (const p of problems) log(`WARN manifest ${p.clientId}: ${p.error}`)
    return manifests
  },
  onWarn: (m) => log(`WARN ${m}`),
})

let ready = false
const healthServer = startHealthServer(config.healthPort, () => ready)
log(`starting: clients=${config.clientsDir} store=postgres tick=${config.tickMs}ms health=${config.healthPort}`)
// immediate first tick, then interval
const first = await runner.tick()
log(`tick: resumed=${first.resumed.length} scheduled=${first.scheduled.length} warnings=${first.warnings.length}`)
ready = true
runner.start(config.tickMs)

const shutdown = async () => {
  runner.stop()
  ready = false
  await new Promise<void>((resolveClose, reject) => healthServer.close((error) => error ? reject(error) : resolveClose()))
  await connection.close()
  log('stopped')
  process.exit(0)
}
process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
