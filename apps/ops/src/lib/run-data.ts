import { randomUUID } from 'node:crypto'
import type { HumanActionEvent } from '@sartre/core'
import type { GateDecisionInput, RunRecord } from '@sartre/pipelines'

export interface OpsRunStore {
  list(clientId: string): Promise<RunRecord[]>
  getScoped(clientId: string, runId: string): Promise<RunRecord | null>
  decideGate(input: GateDecisionInput): Promise<RunRecord>
}

export interface OpsFeedbackLog {
  append(event: HumanActionEvent): Promise<void>
}

export interface PendingGate {
  run: RunRecord
  gateId: string
  step: string
  outputClass: string
  payload: unknown
}

/** Storage-agnostic ops workflow; production injects the Postgres adapters. */
export class OpsRunData {
  constructor(
    private readonly runs: OpsRunStore,
    private readonly feedback: OpsFeedbackLog,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = randomUUID,
  ) {}

  listRuns(clientId: string): Promise<RunRecord[]> {
    return this.runs.list(clientId)
  }

  getRun(clientId: string, runId: string): Promise<RunRecord | null> {
    return this.runs.getScoped(clientId, runId)
  }

  async listPendingGates(clientId: string): Promise<PendingGate[]> {
    const pending: PendingGate[] = []
    for (const run of await this.runs.list(clientId)) {
      for (const gate of run.gates) {
        if (gate.status === 'pending') {
          pending.push({ run, gateId: gate.id, step: gate.step, outputClass: gate.outputClass, payload: gate.payload })
        }
      }
    }
    return pending
  }

  async decideGate(
    clientId: string,
    runId: string,
    gateId: string,
    decision: 'approved' | 'rejected',
    actor: string,
    reason?: string,
  ): Promise<void> {
    const run = await this.runs.getScoped(clientId, runId)
    if (!run) throw new Error(`run ${runId} not found for ${clientId}`)
    const gate = run.gates.find((candidate) => candidate.id === gateId)
    if (!gate) throw new Error(`gate ${gateId} not found`)
    const occurredAt = this.now().toISOString()
    const event: HumanActionEvent = {
      kind: 'human_action',
      id: this.createId(),
      clientId,
      occurredAt,
      actor,
      action: decision === 'approved' ? 'approve' : 'reject',
      machine: { skillId: run.pipelineId, runId: run.runId, itemRef: gateId, output: gate.payload },
      ...(reason !== undefined ? { reason } : {}),
      surface: 'review_queue',
    }
    const decided = await this.runs.decideGate({
      runId,
      gateId,
      decision,
      actor,
      resolvedAt: occurredAt,
      ...(reason !== undefined ? { reason } : {}),
      source: 'via ops surface',
      feedbackEvent: event,
    })
    if (!decided.feedbackEvents?.some((candidate) => candidate.id === event.id)) {
      throw new Error('gate feedback was not persisted with the decision')
    }
    await this.feedback.append(event)
  }
}
