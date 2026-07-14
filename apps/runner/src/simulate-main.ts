import { resolve } from 'node:path'
import { FileClientBrainStore, loadManifestsFromDir } from '@sartre/core'
import { createPostgresConnection, PostgresRuntimeArtifactStore, PostgresToolConnectionStore } from '@sartre/db'
import { loadRunnerConfig } from './config.js'
import { simulateClient } from './simulation.js'
import { StandardRuntimeConfigSchema } from './standard-schemas.js'

const config = loadRunnerConfig(process.env, resolve(import.meta.dirname, '../../..'))
const connection = createPostgresConnection(config.databaseUrl)
const brains = new FileClientBrainStore(config.clientsDir)
try {
  const { manifests, problems } = await loadManifestsFromDir(config.clientsDir)
  if (problems.length) throw new Error(`manifest errors prevent simulation: ${problems.map((item) => item.clientId).join(', ')}`)
  const connections = new PostgresToolConnectionStore(connection)
  const artifacts = new PostgresRuntimeArtifactStore(connection)
  const reports = []
  for (const [clientId, manifest] of manifests) {
    if (manifest.status !== 'active') continue
    let runtime = null
    try { runtime = await brains.loadApprovedConfig(clientId, 'standard-runtime.yaml', StandardRuntimeConfigSchema) } catch { /* connector-free clients remain simulatable */ }
    const inputs: Record<string, unknown> = {}
    for (const [moduleId, module] of Object.entries(manifest.modules)) {
      if (!module.enabled) continue
      const input = await artifacts.get(clientId, `standard-input:${moduleId}`)
      if (input !== null) inputs[moduleId] = input
    }
    reports.push(simulateClient(clientId, manifest, runtime, (await connections.list(clientId)).map((item) => item.provider), inputs))
  }
  console.log(JSON.stringify({ noEffects: true, clients: reports }, null, 2))
} finally {
  await connection.close()
}
