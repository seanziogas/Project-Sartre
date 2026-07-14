import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { createPortabilityBundle, executeGovernanceRequest, retentionCutoffs } from '@sartre/operations'
import { createPostgresConnection, migrate, PostgresGovernanceStore, PostgresPortabilityStore } from '@sartre/db'
import { loadRunnerConfig } from './config.js'

const [command, clientId, requestId, actor, outputArg] = process.argv.slice(2)
if (command !== 'execute' || !clientId || !requestId || !actor) {
  throw new Error('usage: npm run governance -- execute <client-id> <approved-request-id> <actor> [export-path]')
}
const config = loadRunnerConfig(process.env, resolve(import.meta.dirname, '../../..'))
const connection = createPostgresConnection(config.databaseUrl)
try {
  await migrate(connection)
  const governance = new PostgresGovernanceStore(connection)
  const portability = new PostgresPortabilityStore(connection)
  const request = await governance.getRequest(clientId, requestId)
  if (!request || request.status !== 'approved') throw new Error('approved governance request not found')
  const policy = await governance.getPolicy(clientId)
  if (!policy) throw new Error('governance policy is required before execution')

  let detail: string
  if (request.kind === 'export') {
    if (!policy.exportEnabled) throw new Error('portable export is disabled by policy')
    const allRecords = await portability.exportRecords(clientId)
    const records = allRecords.filter((category) => request.scope.some((scope) => portableCategories(scope).includes(category.category)))
    const files = request.scope.includes('brain') ? await collectClientFiles(join(config.clientsDir, clientId)) : {}
    const bundle = createPortabilityBundle(clientId, files, records)
    const output = resolve(outputArg ?? join(resolve(import.meta.dirname, '../../..'), 'portability-exports', `${safeName(clientId)}-${Date.now()}.json`))
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, `${JSON.stringify(bundle, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    detail = `credential-free portability bundle exported to ${output}`
    await portability.audit({ eventId: randomUUID(), clientId, kind: 'exported', actor, detail, occurredAt: new Date().toISOString() })
  } else if (request.kind === 'retention') {
    const cutoffs = retentionCutoffs(policy)
    const counts: Record<string, number> = {}
    for (const category of request.scope) {
      if (category === 'brain') throw new Error('brain retention requires an explicit deletion request')
      counts[category] = await governance.deleteBefore(clientId, category, cutoffs[category])
    }
    detail = `retention sweep executed: ${JSON.stringify(counts)}`
  } else if (request.kind === 'deletion') {
    const eligibleAt = Date.parse(request.requestedAt) + policy.deletionGraceDays * 86_400_000
    if (Date.now() < eligibleAt) throw new Error(`deletion grace period ends ${new Date(eligibleAt).toISOString()}`)
    const counts: Record<string, number> = {}
    const future = new Date(Date.now() + 86_400_000).toISOString()
    for (const category of request.scope) {
      if (category === 'brain') await rm(join(config.clientsDir, clientId), { recursive: true, force: true })
      else counts[category] = await governance.deleteBefore(clientId, category, future)
    }
    detail = `approved tenant deletion executed: ${JSON.stringify(counts)}`
  } else {
    throw new Error('restore requests execute through npm run restore-tenant')
  }
  await governance.putRequest(executeGovernanceRequest(request, actor, new Date().toISOString()))
  console.log(JSON.stringify({ status: 'ok', requestId, kind: request.kind, detail }))
} finally {
  await connection.close()
}

async function collectClientFiles(root: string): Promise<Record<string, string>> {
  const output: Record<string, string> = {}
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || entry.name === '.env' || entry.name.includes('credentials')) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile()) output[relative(root, path)] = await readFile(path, 'utf8')
    }
  }
  await walk(root)
  return output
}

function portableCategories(scope: string): string[] {
  const mapped: Record<string, string[]> = {
    runs: ['runs'], feedback: ['feedback'], connections: ['connection-audit', 'snapshots'], staging: ['staging'],
    canonical: ['canonical'], artifacts: ['artifacts'], effects: ['effects'], brain: [],
    configuration: ['configuration'], evaluations: ['evaluations'], audit: ['connection-audit', 'audit'],
  }
  return mapped[scope] ?? []
}
function safeName(value: string): string { return value.replace(/[^a-zA-Z0-9._-]/g, '_') }
