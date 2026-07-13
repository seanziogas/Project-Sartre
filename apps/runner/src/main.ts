import { resolve } from 'node:path'
import { loadManifestsFromDir } from '@sartre/core'
import { createPostgresConnection, migrate, PostgresRunStore } from '@sartre/db'
import { Runner } from '@sartre/pipelines'
import { buildRegistry } from './registry.js'

/**
 * Runner service entrypoint. Config via env:
 *   SARTRE_CLIENTS_DIR  — client instances (default ../../clients)
 *   DATABASE_URL        — shared Postgres used by ops and runner (required)
 *   SARTRE_TICK_MS      — tick interval (default 30000)
 */
const clientsDir = resolve(process.env.SARTRE_CLIENTS_DIR ?? resolve(import.meta.dirname, '../../../clients'))
const tickMs = Number(process.env.SARTRE_TICK_MS ?? 30_000)
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required for the runner')
const connection = createPostgresConnection(databaseUrl)
await migrate(connection)

const log = (msg: string) => console.log(`[runner ${new Date().toISOString()}] ${msg}`)

const runner = new Runner({
  store: new PostgresRunStore(connection),
  registry: buildRegistry(),
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
