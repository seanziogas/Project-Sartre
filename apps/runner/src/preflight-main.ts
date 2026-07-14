import { resolve } from 'node:path'
import { FileClientBrainStore, loadManifestsFromDir } from '@sartre/core'
import { createPostgresConnection, PostgresToolConnectionStore } from '@sartre/db'
import { loadRunnerConfig } from './config.js'
import { runDeploymentPreflight } from './preflight.js'
import { StandardRuntimeConfigSchema } from './standard-schemas.js'

const config = loadRunnerConfig(process.env, resolve(import.meta.dirname, '../../..'))
const brains = new FileClientBrainStore(config.clientsDir)
const connection = createPostgresConnection(config.databaseUrl)

try {
  const { manifests, problems } = await loadManifestsFromDir(config.clientsDir)
  const connections = new PostgresToolConnectionStore(connection)
  const report = await runDeploymentPreflight({
    manifests,
    manifestProblems: problems,
    loadRuntime: (clientId) => brains.loadApprovedConfig(clientId, 'standard-runtime.yaml', StandardRuntimeConfigSchema),
    listConnectionProviders: async (clientId) => (await connections.list(clientId)).map((item) => item.provider),
    validateBrainContext: async (clientId, paths) => { await brains.loadContext(clientId, paths) },
  })
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) process.exitCode = 1
} finally {
  await connection.close()
}
