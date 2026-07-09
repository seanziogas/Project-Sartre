import { resolve } from 'node:path'
import { loadManifestsFromDir } from '@sartre/core'
import { FileRunStore, Runner } from '@sartre/pipelines'
import { buildRegistry } from './registry.js'

/**
 * Runner service entrypoint. Config via env:
 *   SARTRE_CLIENTS_DIR  — client instances (default ../../clients)
 *   SARTRE_DATA_DIR     — run state (default ../../.sartre-data)
 *   SARTRE_TICK_MS      — tick interval (default 30000)
 */
const clientsDir = resolve(process.env.SARTRE_CLIENTS_DIR ?? resolve(import.meta.dirname, '../../../clients'))
const dataDir = resolve(process.env.SARTRE_DATA_DIR ?? resolve(import.meta.dirname, '../../../.sartre-data'))
const tickMs = Number(process.env.SARTRE_TICK_MS ?? 30_000)

const log = (msg: string) => console.log(`[runner ${new Date().toISOString()}] ${msg}`)

const runner = new Runner({
  store: new FileRunStore(dataDir),
  registry: buildRegistry(),
  manifests: async () => {
    const { manifests, problems } = await loadManifestsFromDir(clientsDir)
    for (const p of problems) log(`WARN manifest ${p.clientId}: ${p.error}`)
    return manifests
  },
  onWarn: (m) => log(`WARN ${m}`),
})

log(`starting: clients=${clientsDir} data=${dataDir} tick=${tickMs}ms`)
// immediate first tick, then interval
const first = await runner.tick()
log(`tick: resumed=${first.resumed.length} scheduled=${first.scheduled.length} warnings=${first.warnings.length}`)
runner.start(tickMs)

process.on('SIGINT', () => {
  runner.stop()
  log('stopped')
  process.exit(0)
})
process.on('SIGTERM', () => {
  runner.stop()
  log('stopped')
  process.exit(0)
})
