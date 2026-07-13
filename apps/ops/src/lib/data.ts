import 'server-only'
import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { parseManifest } from '@sartre/core'
import type { ClientManifest, HumanActionEvent } from '@sartre/core'
import { FileRunStore } from '@sartre/pipelines'
import type { RunRecord } from '@sartre/pipelines'
import type { DataHealthReport } from '@sartre/data'

/**
 * Ops-surface data layer. Every read is client-scoped — this module is the
 * tenancy boundary for the app. Sources:
 *  - manifests/brains: SARTRE_CLIENTS_DIR (default: repo clients/)
 *  - run state + reports + feedback log: SARTRE_DATA_DIR (default: .sartre-data)
 */

const CLIENTS_DIR = resolve(process.env.SARTRE_CLIENTS_DIR ?? join(process.cwd(), '../../clients'))
const DATA_DIR = resolve(process.env.SARTRE_DATA_DIR ?? join(process.cwd(), '../../.sartre-data'))

export const runStore = new FileRunStore(DATA_DIR)

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
  return runStore.list(clientId)
}

export async function getRun(clientId: string, runId: string): Promise<RunRecord | null> {
  return runStore.getScoped(clientId, runId)
}

export interface PendingGate {
  run: RunRecord
  gateId: string
  step: string
  outputClass: string
  payload: unknown
}

export async function listPendingGates(clientId: string): Promise<PendingGate[]> {
  const runs = await runStore.list(clientId)
  const pending: PendingGate[] = []
  for (const run of runs) {
    for (const gate of run.gates) {
      if (gate.status === 'pending') {
        pending.push({ run, gateId: gate.id, step: gate.step, outputClass: gate.outputClass, payload: gate.payload })
      }
    }
  }
  return pending
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
  const run = await runStore.getScoped(clientId, runId)
  if (!run) throw new Error(`run ${runId} not found for ${clientId}`)
  const now = new Date().toISOString()
  const gate = run.gates.find((candidate) => candidate.id === gateId)
  if (!gate) throw new Error(`gate ${gateId} not found`)
  const event: HumanActionEvent = {
    kind: 'human_action',
    id: randomUUID(),
    clientId,
    occurredAt: now,
    actor,
    action: decision === 'approved' ? 'approve' : 'reject',
    machine: { skillId: run.pipelineId, runId: run.runId, itemRef: gateId, output: gate.payload },
    ...(reason !== undefined ? { reason } : {}),
    surface: 'review_queue',
  }
  const decided = await runStore.decideGate({
    runId,
    gateId,
    decision,
    actor,
    resolvedAt: now,
    ...(reason !== undefined ? { reason } : {}),
    source: 'via ops surface',
    feedbackEvent: event,
  })
  if (!decided.feedbackEvents?.some((candidate) => candidate.id === event.id)) throw new Error('gate feedback was not persisted')
  await appendFeedbackEvent(clientId, event)
}

async function appendFeedbackEvent(clientId: string, event: HumanActionEvent): Promise<void> {
  const dir = join(DATA_DIR, clientId.replace(/[^a-zA-Z0-9 _.-]/g, '_'))
  await mkdir(dir, { recursive: true })
  await appendFile(join(dir, 'feedback-events.jsonl'), JSON.stringify(event) + '\n')
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
