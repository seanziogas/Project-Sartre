import 'server-only'
import { randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { assertApprovedConfigText, parseManifest } from '@sartre/core'
import type { ClientManifest, FeedbackEvent } from '@sartre/core'
import type { RunRecord } from '@sartre/pipelines'
import type { DataHealthReport } from '@sartre/data'
import { createProviderClient, credentialKeyConfigFromEnvironment, CredentialVault, isSupportedProvider, productionHttpTransport, ToolConnectionInput, validateProviderCredentials } from '@sartre/connectors'
import type { ConnectionHealth, ToolConnectionEvent, ToolConnectionSummary } from '@sartre/connectors'
import { getOpsDatabase } from './postgres'
import { logOpsEvent, safeOperationalMessage } from './operational-log'
import type { PendingGate } from './run-data'
import {
  buildLearningControlCenter,
  createConfigRelease,
  decideGovernanceRequest,
  decidePromotion,
  evaluateSlos,
  GovernancePolicy,
  GovernanceRequest,
  requestPromotion,
} from '@sartre/operations'
import type { ConfigStage, GovernancePolicy as GovernancePolicyType, GovernanceRequest as GovernanceRequestType } from '@sartre/operations'

/**
 * Ops-surface data layer. Every read is client-scoped — this module is the
 * tenancy boundary for the app. Sources:
 *  - manifests/brains: SARTRE_CLIENTS_DIR (default: repo clients/)
 *  - run state, feedback, MVD, and health reports: Postgres via DATABASE_URL
 *  - legacy health fallback: SARTRE_DATA_DIR (default: .sartre-data)
 */

const CLIENTS_DIR = resolve(process.env.SARTRE_CLIENTS_DIR ?? join(process.cwd(), '../../clients'))
const DATA_DIR = resolve(process.env.SARTRE_DATA_DIR ?? join(process.cwd(), '../../.sartre-data'))

export interface ClientSummary {
  id: string
  name: string
  status: string
  modulesEnabled: number
}

export async function listClients(): Promise<ClientSummary[]> {
  let entries: string[]
  try {
    entries = (await readdir(CLIENTS_DIR, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.'))
      .map((e) => e.name)
  } catch {
    return []
  }
  const clients: ClientSummary[] = []
  for (const id of entries) {
    const manifest = await getManifest(id)
    if (!manifest) continue
    clients.push({
      id,
      name: manifest.client.name,
      status: manifest.status,
      modulesEnabled: Object.values(manifest.modules).filter((m) => m.enabled).length,
    })
  }
  return clients
}

export async function getManifest(clientId: string): Promise<ClientManifest | null> {
  if (clientId.includes('/') || clientId.includes('..')) return null // path safety
  try {
    let productionManifest: string | undefined
    let database: Awaited<ReturnType<typeof getOpsDatabase>> | undefined
    try {
      database = await getOpsDatabase()
      const production = (await database.configReleases.list(clientId)).find((release) => release.stage === 'production' && release.status === 'active')
      productionManifest = production?.files['client.yaml']
    } catch {
      // File-backed development mode remains readable before database setup.
    }
    let manifest = parseManifest(productionManifest ?? await readFile(join(CLIENTS_DIR, clientId, 'client.yaml'), 'utf8'))
    try {
      database ??= await getOpsDatabase()
      const runtimeMvd = await database.artifacts.get<ClientManifest['mvd']>(clientId, 'mvd')
      if (runtimeMvd) manifest.mvd = runtimeMvd
    } catch {
      // The manifest remains readable during initial DB setup or a transient DB outage.
    }
    return manifest
  } catch {
    return null
  }
}

export async function listRuns(clientId: string): Promise<RunRecord[]> {
  return (await getOpsDatabase()).data.listRuns(clientId)
}

export async function getRun(clientId: string, runId: string): Promise<RunRecord | null> {
  return (await getOpsDatabase()).data.getRun(clientId, runId)
}

export async function listPendingGates(clientId: string): Promise<PendingGate[]> {
  return (await getOpsDatabase()).data.listPendingGates(clientId)
}

export async function listFeedback(clientId: string, limit = 500): Promise<FeedbackEvent[]> {
  return (await getOpsDatabase()).data.listFeedback(clientId, limit)
}

export async function listToolConnections(clientId: string): Promise<ToolConnectionSummary[]> {
  return (await getOpsDatabase()).connections.list(clientId)
}

export async function listToolConnectionEvents(clientId: string): Promise<ToolConnectionEvent[]> {
  return (await getOpsDatabase()).connectionEvents.list(clientId)
}

export async function connectTool(
  clientId: string,
  input: unknown,
  actor: string,
): Promise<ToolConnectionSummary> {
  const parsed = ToolConnectionInput.parse(input)
  validateProviderCredentials(parsed.provider, parsed.credentials, parsed.authKind)
  const key = credentialKeyConfigFromEnvironment(process.env)
  if (!key) throw new Error('SARTRE_CREDENTIAL_ENCRYPTION_KEY is required to save connections')
  const now = new Date().toISOString()
  const database = await getOpsDatabase()
  const connectionId = randomUUID()
  const summary = await database.connections.put({
    connectionId,
    clientId,
    provider: parsed.provider,
    authKind: parsed.authKind,
    label: parsed.label,
    status: 'active',
    encryptedCredentials: new CredentialVault(key).seal(parsed.credentials, clientId),
    metadata: { ...parsed.metadata, connectedBy: actor },
    createdAt: now,
    updatedAt: now,
  })
  await database.connectionEvents.append({
    eventId: randomUUID(), connectionId, clientId, kind: 'connected', actor,
    detail: `${parsed.provider} connection created`, occurredAt: now,
  })
  return summary
}

export async function revokeToolConnection(
  clientId: string,
  connectionId: string,
  actor: string,
): Promise<boolean> {
  const database = await getOpsDatabase()
  const now = new Date().toISOString()
  const revoked = await database.connections.revoke(clientId, connectionId, now)
  if (revoked) await database.connectionEvents.append({
    eventId: randomUUID(), connectionId, clientId, kind: 'revoked', actor,
    detail: 'connection revoked and credential envelope destroyed', occurredAt: now,
  })
  return revoked
}

export async function rotateToolConnection(
  clientId: string,
  connectionId: string,
  credentials: Record<string, string>,
  actor: string,
): Promise<ToolConnectionSummary> {
  const key = credentialKeyConfigFromEnvironment(process.env)
  if (!key) throw new Error('SARTRE_CREDENTIAL_ENCRYPTION_KEY is required to rotate connections')
  const database = await getOpsDatabase()
  const stored = await database.connections.get(clientId, connectionId)
  if (!stored || stored.status !== 'active') throw new Error('active connection not found for client')
  const existing = new CredentialVault(key).open(stored.encryptedCredentials, clientId)
  const parsed = ToolConnectionInput.parse({
    provider: stored.provider, authKind: stored.authKind, label: stored.label,
    credentials: { ...existing, ...credentials }, metadata: stored.metadata,
  })
  const now = new Date().toISOString()
  const summary = await database.connections.put({
    ...stored, encryptedCredentials: new CredentialVault(key).seal(parsed.credentials, clientId), updatedAt: now,
  })
  await database.connectionEvents.append({
    eventId: randomUUID(), connectionId, clientId, kind: 'rotated', actor,
    detail: `${stored.provider} credentials rotated`, occurredAt: now,
  })
  return summary
}

export async function testToolConnection(
  clientId: string,
  connectionId: string,
  actor: string,
): Promise<ConnectionHealth> {
  const key = credentialKeyConfigFromEnvironment(process.env)
  if (!key) throw new Error('SARTRE_CREDENTIAL_ENCRYPTION_KEY is required to test connections')
  const database = await getOpsDatabase()
  const stored = await database.connections.get(clientId, connectionId)
  if (!stored || stored.status !== 'active') throw new Error('active connection not found for client')
  if (!isSupportedProvider(stored.provider)) {
    throw new Error(`connection testing is not available for ${stored.provider}`)
  }
  const credentials = new CredentialVault(key).open(stored.encryptedCredentials, clientId)
  try {
    const health = await createProviderClient(stored.provider, credentials, productionHttpTransport()).testConnection()
    await database.connectionEvents.append({
      eventId: randomUUID(), connectionId, clientId, kind: 'tested', actor,
      detail: health.detail, occurredAt: new Date().toISOString(),
    })
    logOpsEvent('info', 'connector_test_succeeded', { clientId, connectionId, provider: stored.provider })
    return health
  } catch (error) {
    const message = safeOperationalMessage(error)
    try {
      await database.connectionEvents.append({
        eventId: randomUUID(), connectionId, clientId, kind: 'tested', actor,
        detail: `connection test failed: ${message}`, occurredAt: new Date().toISOString(),
      })
    } catch (auditError) {
      logOpsEvent('error', 'connector_test_audit_failed', { clientId, connectionId, provider: stored.provider, message: safeOperationalMessage(auditError) })
    }
    logOpsEvent('warn', 'connector_test_failed', { clientId, connectionId, provider: stored.provider, message })
    throw error
  }
}

/**
 * Record a gate decision. The ops surface does NOT resume runs — it records
 * the decision and the Layer-8 feedback event; the runner service picks up
 * resolved gates and resumes (or terminates) the run.
 */
export async function decideGate(
  clientId: string,
  runId: string,
  gateId: string,
  decision: 'approved' | 'rejected',
  actor: string,
  reason?: string,
): Promise<void> {
  return (await getOpsDatabase()).data.decideGate(clientId, runId, gateId, decision, actor, reason)
}

export async function getHealthReport(clientId: string): Promise<DataHealthReport | null> {
  if (clientId.includes('/') || clientId.includes('..')) return null
  try {
    const report = await (await getOpsDatabase()).artifacts.get<DataHealthReport>(clientId, 'health-report')
    if (report) return report
  } catch {
    // Retain the file fallback for deployments upgraded from the v1 file store.
  }
  try {
    const raw = await readFile(
      join(DATA_DIR, clientId.replace(/[^a-zA-Z0-9 _.-]/g, '_'), 'health-report.json'),
      'utf8',
    )
    return JSON.parse(raw) as DataHealthReport
  } catch {
    return null
  }
}

export function budgetUsage(manifest: ClientManifest, runs: RunRecord[]): {
  monthCredits: number
  monthTokensUsd: number
  creditCap: number | null
  tokenCapUsd: number | null
} {
  const monthStart = new Date()
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)
  const thisMonth = runs.filter((r) => new Date(r.createdAt) >= monthStart)
  return {
    monthCredits: thisMonth.reduce((s, r) => s + r.spend.clayCredits, 0),
    monthTokensUsd: thisMonth.reduce((s, r) => s + r.spend.tokensUsd, 0),
    creditCap: manifest.budgets.clay_credits_monthly,
    tokenCapUsd: manifest.budgets.token_budget_monthly_usd,
  }
}

export async function getOperationsDashboard(clientId: string) {
  return evaluateSlos(await listRuns(clientId))
}

export async function getGovernance(clientId: string) {
  const database = await getOpsDatabase()
  return {
    policy: await database.governance.getPolicy(clientId),
    requests: await database.governance.listRequests(clientId),
    portabilityEvents: await database.portability.listAudit(clientId),
  }
}

export async function saveGovernancePolicy(clientId: string, value: unknown, actor: string): Promise<void> {
  const policy = GovernancePolicy.parse({ ...(value as object), clientId, updatedAt: new Date().toISOString(), updatedBy: actor })
  await (await getOpsDatabase()).governance.putPolicy(policy)
}

export async function createGovernanceRequest(
  clientId: string,
  kind: GovernanceRequestType['kind'],
  scope: GovernanceRequestType['scope'],
  reason: string,
  actor: string,
): Promise<GovernanceRequestType> {
  const request = GovernanceRequest.parse({
    requestId: randomUUID(), clientId, kind, scope, reason, status: 'pending', requestedBy: actor, requestedAt: new Date().toISOString(),
    decidedBy: null, decidedAt: null, executedBy: null, executedAt: null,
  })
  await (await getOpsDatabase()).governance.putRequest(request)
  return request
}

export async function resolveGovernanceRequest(clientId: string, requestId: string, decision: 'approved' | 'rejected', actor: string): Promise<void> {
  const store = (await getOpsDatabase()).governance
  const request = await store.getRequest(clientId, requestId)
  if (!request) throw new Error('governance request not found')
  await store.putRequest(decideGovernanceRequest(request, decision, actor, new Date().toISOString()))
}

export async function listConfigReleases(clientId: string) {
  return (await getOpsDatabase()).configReleases.list(clientId)
}

export async function captureConfigRelease(clientId: string, actor: string) {
  const store = (await getOpsDatabase()).configReleases
  const files = await readReleaseFiles(clientId)
  parseManifest(files['client.yaml']!)
  if (files['brain/config/standard-runtime.yaml']) assertApprovedConfigText(files['brain/config/standard-runtime.yaml'], `${clientId}/brain/config/standard-runtime.yaml`)
  const release = createConfigRelease(clientId, await store.nextVersion(clientId), files, actor)
  await store.put(release)
  return release
}

export async function requestConfigPromotion(clientId: string, releaseId: string, target: ConfigStage, actor: string): Promise<void> {
  const store = (await getOpsDatabase()).configReleases
  const release = await store.get(clientId, releaseId)
  if (!release) throw new Error('configuration release not found')
  await store.put(requestPromotion(release, target, actor))
}

export async function resolveConfigPromotion(clientId: string, releaseId: string, decision: 'approved' | 'rejected', actor: string): Promise<void> {
  const store = (await getOpsDatabase()).configReleases
  const release = await store.get(clientId, releaseId)
  if (!release) throw new Error('configuration release not found')
  await store.put(decidePromotion(release, decision, actor))
}

export async function getLearningControlCenter(clientId: string) {
  const database = await getOpsDatabase()
  return buildLearningControlCenter(
    await database.evaluations.list(clientId),
    await database.artifacts.listPrefix(clientId, 'learning:'),
  )
}

async function readReleaseFiles(clientId: string): Promise<Record<string, string>> {
  if (clientId.includes('/') || clientId.includes('..')) throw new Error('invalid client id')
  const root = join(CLIENTS_DIR, clientId)
  const files: Record<string, string> = { 'client.yaml': await readFile(join(root, 'client.yaml'), 'utf8') }
  const configRoot = join(root, 'brain', 'config')
  try {
    for (const entry of await readdir(configRoot, { withFileTypes: true })) {
      if (entry.isFile() && !entry.name.startsWith('.')) files[`brain/config/${entry.name}`] = await readFile(join(configRoot, entry.name), 'utf8')
    }
  } catch {
    // A client with manifest-only configuration is still releasable.
  }
  return files
}
