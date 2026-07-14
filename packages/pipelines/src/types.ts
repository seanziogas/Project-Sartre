import { z } from 'zod'
import type { ClientManifest, HumanActionEvent } from '@sartre/core'

/**
 * Pipeline engine types (Layer 4). A pipeline is a declared sequence of
 * steps orchestrating skills into a module workflow. Runs are resumable:
 * every step's output is checkpointed; a crashed or gated run picks up where
 * it stopped.
 */

export const RunStatus = z.enum([
  'pending',
  'running',
  'awaiting_approval', // stopped at a human gate
  'completed',
  'failed',
  'rejected', // human rejected at a gate
  'blocked', // MVD gate refused to start it
])
export type RunStatus = z.infer<typeof RunStatus>

export const JournalEntry = z.object({
  at: z.string().datetime(),
  step: z.string().nullable(),
  event: z.enum([
    'run_started',
    'step_started',
    'step_completed',
    'step_failed',
    'gate_opened',
    'gate_resolved',
    'budget_spent',
    'budget_exceeded',
    'run_completed',
    'run_failed',
    'run_blocked',
    'run_rejected',
  ]),
  detail: z.string(),
})
export type JournalEntry = z.infer<typeof JournalEntry>

export const GateRecord = z.object({
  id: z.string(),
  step: z.string(),
  outputClass: z.enum(['outbound_send', 'crm_write', 'client_comms', 'brain_change', 'internal_report']),
  /** What the human reviews — skill output, verbatim. */
  payload: z.unknown(),
  status: z.enum(['pending', 'approved', 'rejected']),
  resolvedBy: z.string().nullable(),
  resolvedAt: z.string().datetime().nullable(),
})
export type GateRecord = z.infer<typeof GateRecord>

export const BudgetSpend = z.object({
  clayCredits: z.number().default(0),
  tokensUsd: z.number().default(0),
})
export type BudgetSpend = z.infer<typeof BudgetSpend>

export interface RunRecord {
  runId: string
  pipelineId: string
  moduleId: string
  clientId: string
  status: RunStatus
  /** Step id → checkpointed output. Completed steps are never re-executed. */
  checkpoints: Record<string, unknown>
  journal: JournalEntry[]
  gates: GateRecord[]
  /** Durable Layer-8 events captured atomically with gate decisions. */
  feedbackEvents?: HumanActionEvent[]
  spend: BudgetSpend
  createdAt: string
  updatedAt: string
}

export interface GateDecisionInput {
  runId: string
  gateId: string
  decision: 'approved' | 'rejected'
  actor: string
  resolvedAt: string
  reason?: string
  source?: string
  feedbackEvent?: HumanActionEvent
}

export interface RunStore {
  get(runId: string): Promise<RunRecord | null>
  save(run: RunRecord): Promise<void>
  /** Atomically transition one pending gate; competing decisions must fail. */
  decideGate(input: GateDecisionInput): Promise<RunRecord>
}

/** What the runner service needs beyond basic get/save. */
export interface RunnerStore extends RunStore {
  listByStatus(status: RunStatus): Promise<RunRecord[]>
}

export class MemoryRunStore implements RunnerStore {
  private runs = new Map<string, RunRecord>()
  async get(runId: string): Promise<RunRecord | null> {
    const run = this.runs.get(runId)
    return run ? structuredClone(run) : null
  }
  async save(run: RunRecord): Promise<void> {
    this.runs.set(run.runId, structuredClone(run))
  }
  async decideGate(input: GateDecisionInput): Promise<RunRecord> {
    const run = this.runs.get(input.runId)
    if (!run) throw new Error(`run ${input.runId} not found`)
    applyGateDecision(run, input)
    this.runs.set(run.runId, structuredClone(run))
    return structuredClone(run)
  }
  async listByStatus(status: RunStatus): Promise<RunRecord[]> {
    return [...this.runs.values()].filter((r) => r.status === status).map((r) => structuredClone(r))
  }
}

export function applyGateDecision(run: RunRecord, input: GateDecisionInput): RunRecord {
  const gate = run.gates.find((g) => g.id === input.gateId)
  if (!gate) throw new Error(`gate ${input.gateId} not found on run ${run.runId}`)
  if (gate.status !== 'pending') throw new Error(`gate ${input.gateId} already ${gate.status}`)
  if (input.actor.trim() === '') throw new Error('gate decision actor is required')
  if (input.feedbackEvent) {
    if (input.feedbackEvent.clientId !== run.clientId || input.feedbackEvent.machine.runId !== run.runId || input.feedbackEvent.machine.itemRef !== input.gateId) {
      throw new Error('feedback event does not match the gate decision')
    }
  }
  gate.status = input.decision
  gate.resolvedBy = input.actor
  gate.resolvedAt = input.resolvedAt
  run.journal.push({
    at: input.resolvedAt,
    step: gate.step,
    event: 'gate_resolved',
    detail: `${gate.outputClass} ${input.decision} by ${input.actor}${input.reason ? `: ${input.reason}` : ''}${input.source ? ` (${input.source})` : ''}`,
  })
  run.updatedAt = input.resolvedAt
  if (input.feedbackEvent) (run.feedbackEvents ??= []).push(input.feedbackEvent)
  return run
}

/** What a step sees. Budget spends throw when the cap is hit. */
export interface StepContext {
  clientId: string
  runId: string
  manifest: ClientManifest
  /** Outputs of previously completed steps, by step id. */
  outputs: Record<string, unknown>
  /** Record credit spend; throws BudgetExceededError past the per-run cap. */
  spendCredits(n: number, why: string): void
  /** Record token spend in USD; throws BudgetExceededError past the cap. */
  spendTokensUsd(n: number, why: string): void
  /**
   * Human gate. The manifest policy is structurally `block`; the run pauses
   * until an attributed human decision resolves it.
   * When blocked, the step's work so far MUST already be in its return value —
   * the gate is the last thing a step does before its output ships.
   */
  gate(outputClass: GateRecord['outputClass'], payload: unknown): Promise<void>
}

export interface PipelineStep {
  id: string
  /** Durable idempotency boundary for a post-gate side-effect step. */
  effect?: boolean
  run(ctx: StepContext): Promise<unknown>
}

export interface PipelineDefinition {
  id: string
  /** Canonical module id — MVD-gated via manifest before any step runs. */
  moduleId: string
  /**
   * The Day-1 data audit creates MVD and therefore cannot depend on MVD or
   * module activation. This explicit mode is reserved for non-CRM-mutating
   * data-foundation pipelines; all ordinary pipelines default to module_mvd.
   */
  preflight?: 'module_mvd' | 'data_audit'
  steps: PipelineStep[]
}

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BudgetExceededError'
  }
}

/** Thrown internally when a gate blocks; the engine catches it and parks the run. */
export class GateBlockedSignal extends Error {
  constructor(readonly gateId: string) {
    super(`gate ${gateId} awaiting approval`)
    this.name = 'GateBlockedSignal'
  }
}
