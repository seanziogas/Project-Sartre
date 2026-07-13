import 'server-only'
import { randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseManifest } from '@sartre/core'
import type { ClientManifest, FeedbackEvent } from '@sartre/core'
import type { RunRecord } from '@sartre/pipelines'
import type { DataHealthReport } from '@sartre/data'
import { CredentialVault, ToolConnectionInput } from '@sartre/connectors'
import type { ToolConnectionSummary } from '@sartre/connectors'
import { getOpsDatabase } from './postgres'
import type { PendingGate } from './run-data'

/**
 * Ops-surface data layer. Every read is client-scoped — this module is the
 * tenancy boundary for the app. Sources:
 *  - manifests/brains: SARTRE_CLIENTS_DIR (default: repo clients/)
 *  - run state + feedback log: Postgres via DATABASE_URL
 *  - health reports: SARTRE_DATA_DIR (default: .sartre-data)
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
    return parseManifest(await readFile(join(CLIENTS_DIR, clientId, 'client.yaml'), 'utf8'))
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

export async function connectTool(
  clientId: string,
  input: unknown,
  actor: string,
): Promise<ToolConnectionSummary> {
  const parsed = ToolConnectionInput.parse(input)
  const key = process.env.SARTRE_CREDENTIAL_ENCRYPTION_KEY
  if (!key) throw new Error('SARTRE_CREDENTIAL_ENCRYPTION_KEY is required to save connections')
  const now = new Date().toISOString()
  return (await getOpsDatabase()).connections.put({
    connectionId: randomUUID(),
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
}

export async function revokeToolConnection(
  clientId: string,
  connectionId: string,
): Promise<boolean> {
  return (await getOpsDatabase()).connections.revoke(clientId, connectionId, new Date().toISOString())
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
