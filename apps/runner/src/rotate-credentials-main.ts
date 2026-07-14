import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { CredentialVault } from '@sartre/connectors'
import { loadManifestsFromDir } from '@sartre/core'
import { createPostgresConnection, PostgresToolConnectionEventStore, PostgresToolConnectionStore } from '@sartre/db'
import { loadRunnerConfig } from './config.js'

const config = loadRunnerConfig(process.env, resolve(import.meta.dirname, '../../..'))
if (!config.credentialKeys || typeof config.credentialKeys === 'string') {
  throw new Error('versioned credential keyring configuration is required for rotation')
}
const connection = createPostgresConnection(config.databaseUrl)
const vault = new CredentialVault(config.credentialKeys)
let rotated = 0

try {
  const { manifests, problems } = await loadManifestsFromDir(config.clientsDir)
  if (problems.length) throw new Error(`manifest errors prevent rotation: ${problems.map((item) => item.clientId).join(', ')}`)
  const store = new PostgresToolConnectionStore(connection)
  const events = new PostgresToolConnectionEventStore(connection)
  for (const clientId of manifests.keys()) {
    for (const summary of await store.list(clientId)) {
      const stored = await store.get(clientId, summary.connectionId)
      if (!stored || !vault.needsRotation(stored.encryptedCredentials)) continue
      const credentials = vault.open(stored.encryptedCredentials, clientId)
      const updatedAt = new Date().toISOString()
      await store.put({ ...stored, encryptedCredentials: vault.seal(credentials, clientId), updatedAt })
      await events.append({
        eventId: randomUUID(), connectionId: stored.connectionId, clientId, kind: 'rotated',
        actor: 'system:key-rotation', detail: `credential envelope rotated to ${config.credentialKeys.currentKeyId}`,
        occurredAt: updatedAt,
      })
      rotated++
    }
  }
  console.log(JSON.stringify({ status: 'ok', rotated }))
} finally {
  await connection.close()
}
