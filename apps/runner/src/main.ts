import { resolve } from 'node:path'
import { FileClientBrainStore, loadManifestsFromDir } from '@sartre/core'
import { createPostgresConnection, migrate, PostgresRunStore, PostgresToolConnectionStore } from '@sartre/db'
import { Runner } from '@sartre/pipelines'
import { AnthropicLlmClient } from '@sartre/skills'
import { loadModuleDeps } from './deployment.js'
import { buildRegistry } from './registry.js'
import { TenantConnectionResolver } from './connections.js'
import { TenantToolClients } from './tools.js'

/**
 * Runner service entrypoint. Config via env:
 *   SARTRE_CLIENTS_DIR  — client instances (default ../../clients)
 *   DATABASE_URL        — shared Postgres used by ops and runner (required)
 *   SARTRE_MODULE_DEPS  — optional deployment adapter; required only to execute configured modules
 *   SARTRE_CREDENTIAL_ENCRYPTION_KEY — required only when an adapter resolves a client connection
 *   SARTRE_TICK_MS      — tick interval (default 30000)
 */
const clientsDir = resolve(process.env.SARTRE_CLIENTS_DIR ?? resolve(import.meta.dirname, '../../../clients'))
const tickMs = Number(process.env.SARTRE_TICK_MS ?? 30_000)
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required for the runner')
const connection = createPostgresConnection(databaseUrl)
const llm = new AnthropicLlmClient('claude-opus-4-8')
const brains = new FileClientBrainStore(clientsDir)
const connections = new TenantConnectionResolver(
  new PostgresToolConnectionStore(connection),
  process.env.SARTRE_CREDENTIAL_ENCRYPTION_KEY,
)
const tools = new TenantToolClients(connection, connections)
const moduleDeps = await initializeModuleDeps()

async function initializeModuleDeps() {
  try {
    await migrate(connection)
    return await loadModuleDeps(process.env.SARTRE_MODULE_DEPS, { db: connection, brains, connections, tools })
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
    const { manifests, problems } = await loadManifestsFromDir(clientsDir)
    for (const p of problems) log(`WARN manifest ${p.clientId}: ${p.error}`)
    return manifests
  },
  onWarn: (m) => log(`WARN ${m}`),
})

log(`starting: clients=${clientsDir} store=postgres tick=${tickMs}ms`)
// immediate first tick, then interval
const first = await runner.tick()
log(`tick: resumed=${first.resumed.length} scheduled=${first.scheduled.length} warnings=${first.warnings.length}`)
runner.start(tickMs)

const shutdown = async () => {
  runner.stop()
  await connection.close()
  log('stopped')
  process.exit(0)
}
process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
