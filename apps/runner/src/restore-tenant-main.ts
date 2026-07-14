import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { parseManifest } from '@sartre/core'
import { executeGovernanceRequest, verifyPortabilityBundle } from '@sartre/operations'
import { createPostgresConnection, migrate, PostgresGovernanceStore, PostgresPortabilityStore } from '@sartre/db'
import { loadRunnerConfig } from './config.js'

const [bundlePath, requestId, actor] = process.argv.slice(2)
if (!bundlePath || !requestId || !actor) throw new Error('usage: npm run restore-tenant -- <bundle-path> <approved-request-id> <actor>')
const config = loadRunnerConfig(process.env, resolve(import.meta.dirname, '../../..'))
const bundle = verifyPortabilityBundle(JSON.parse(await readFile(resolve(bundlePath), 'utf8')))
if (bundle.files['client.yaml']) parseManifest(bundle.files['client.yaml'])
const target = join(config.clientsDir, bundle.clientId)
try { await access(target); throw new Error(`restore target ${bundle.clientId} already exists`) } catch (error) {
  if (error instanceof Error && error.message.startsWith('restore target')) throw error
}

const connection = createPostgresConnection(config.databaseUrl)
const temporary = join(config.clientsDir, `.restore-${randomUUID()}`)
let restoreStarted = false
try {
  await migrate(connection)
  const governance = new PostgresGovernanceStore(connection)
  const portability = new PostgresPortabilityStore(connection)
  const request = await governance.getRequest(bundle.clientId, requestId)
  if (!request || request.kind !== 'restore' || request.status !== 'approved') throw new Error('approved restore request not found')
  await portability.audit({
    eventId: randomUUID(), clientId: bundle.clientId, kind: 'validated', actor,
    detail: `portability bundle checksum ${bundle.checksum} validated; credentials absent`, occurredAt: new Date().toISOString(),
  })
  await mkdir(temporary, { recursive: false, mode: 0o700 })
  for (const [path, content] of Object.entries(bundle.files)) {
    const destination = join(temporary, path)
    if (!destination.startsWith(`${temporary}/`)) throw new Error('unsafe restore path')
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, content, { encoding: 'utf8', mode: 0o600 })
  }
  await portability.assertRestoreTargetEmpty(bundle.clientId)
  restoreStarted = true
  const counts = await portability.restoreRecords(bundle.clientId, bundle.records)
  await rename(temporary, target)
  const detail = `checksum-verified tenant bundle restored without credentials: ${JSON.stringify(counts)}`
  await portability.audit({ eventId: randomUUID(), clientId: bundle.clientId, kind: 'restored', actor, detail, occurredAt: new Date().toISOString() })
  await governance.putRequest(executeGovernanceRequest(request, actor, new Date().toISOString()))
  console.log(JSON.stringify({ status: 'ok', clientId: bundle.clientId, counts }))
} catch (error) {
  await rm(temporary, { recursive: true, force: true })
  if (restoreStarted) await new PostgresPortabilityStore(connection).clearPortableData(bundle.clientId)
  throw error
} finally {
  await connection.close()
}
