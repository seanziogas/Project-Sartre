import { randomUUID } from 'node:crypto'
import { moduleRunnable } from '@sartre/core'
import type { ClientManifest, HumanActionEvent } from '@sartre/core'
import {
  BudgetExceededError,
  GateBlockedSignal,
} from './types.js'
import type {
  GateRecord,
  JournalEntry,
  PipelineDefinition,
  RunRecord,
  RunStore,
  StepContext,
} from './types.js'

/**
 * Pipeline engine (Layer 4). Deterministic orchestration with:
 *  - MVD gate: a run on a module whose data isn't ready never starts
 *  - checkpointing: completed steps never re-execute; resume picks up mid-run
 *  - budgets: per-run credit/token caps from the manifest, hard-enforced
 *  - human gates: every declared gate blocks; runs park as awaiting_approval
 *    and resume only after an attributed human resolution
 *  - journal: every event appended, nothing silent
 *
 * Step contract: steps are idempotent up to their gate call — a gated step
 * re-executes from its top on resume, so side effects belong after the gate
 * or must be safe to repeat.
 */

class GateRejectedSignal extends Error {
  constructor(readonly gateId: string) {
    super(`gate ${gateId} rejected`)
    this.name = 'GateRejectedSignal'
  }
}

export interface EngineOptions {
  now?: () => Date
  runId?: string
  /** Layer 8 capture: gate resolutions become feedback events. */
  onFeedbackEvent?: (event: HumanActionEvent) => void | Promise<void>
}

export class PipelineEngine {
  private readonly now: () => Date
  constructor(
    private readonly store: RunStore,
    private readonly options: EngineOptions = {},
  ) {
    this.now = options.now ?? (() => new Date())
  }

  /** Start a new run. Returns the run in its post-execution state. */
  async start(
    pipeline: PipelineDefinition,
    manifest: ClientManifest,
    clientId: string,
  ): Promise<RunRecord> {
    const nowIso = this.now().toISOString()
    const run: RunRecord = {
      runId: this.options.runId ?? randomUUID(),
      pipelineId: pipeline.id,
      moduleId: pipeline.moduleId,
      clientId,
      status: 'pending',
      checkpoints: {},
      journal: [],
      gates: [],
      feedbackEvents: [],
      spend: { clayCredits: 0, tokensUsd: 0 },
      createdAt: nowIso,
      updatedAt: nowIso,
    }

    if ((pipeline.preflight ?? 'module_mvd') === 'module_mvd') {
      const gateCheck = moduleRunnable(manifest, pipeline.moduleId)
      if (!gateCheck.runnable) {
        run.status = 'blocked'
        this.journal(run, null, 'run_blocked', gateCheck.reason)
        await this.store.save(run)
        return run
      }
      this.journal(run, null, 'run_started', `module ${pipeline.moduleId}: ${gateCheck.reason}`)
    } else {
      this.journal(run, null, 'run_started', `data audit bootstrap for ${pipeline.moduleId}`)
    }
    return this.execute(pipeline, run, manifest)
  }

  /** Resume a parked or crashed run. Completed steps are skipped via checkpoints. */
  async resume(pipeline: PipelineDefinition, runId: string, manifest: ClientManifest): Promise<RunRecord> {
    const run = await this.store.get(runId)
    if (!run) throw new Error(`run ${runId} not found`)
    if (run.status === 'completed' || run.status === 'rejected' || run.status === 'blocked') return run
    if (run.gates.some((g) => g.status === 'pending')) {
      // still parked — nothing to do until the gate resolves
      return run
    }
    return this.execute(pipeline, run, manifest)
  }

  /**
   * Resolve a pending gate. Emits a Layer-8 feedback event, then resumes the
   * run (approval) or terminates it (rejection).
   */
  async resolveGate(
    pipeline: PipelineDefinition,
    runId: string,
    gateId: string,
    decision: 'approved' | 'rejected',
    actor: string,
    manifest: ClientManifest,
    reason?: string,
  ): Promise<RunRecord> {
    const resolvedAt = this.now().toISOString()
    const existing = await this.store.get(runId)
    if (!existing) throw new Error(`run ${runId} not found`)
    const gate = existing.gates.find((candidate) => candidate.id === gateId)
    if (!gate) throw new Error(`gate ${gateId} not found on run ${runId}`)
    const feedbackEvent: HumanActionEvent = {
      kind: 'human_action',
      id: randomUUID(),
      clientId: existing.clientId,
      occurredAt: resolvedAt,
      actor,
      action: decision === 'approved' ? 'approve' : 'reject',
      machine: {
        skillId: existing.pipelineId,
        runId: existing.runId,
        itemRef: gateId,
        output: gate.payload,
      },
      ...(reason !== undefined ? { reason } : {}),
      surface: 'review_queue',
    }
    const run = await this.store.decideGate({
      runId,
      gateId,
      decision,
      actor,
      resolvedAt,
      ...(reason !== undefined ? { reason } : {}),
      feedbackEvent,
    })
    await this.options.onFeedbackEvent?.(feedbackEvent)

    return this.execute(pipeline, run, manifest)
  }

  private async execute(pipeline: PipelineDefinition, run: RunRecord, manifest: ClientManifest): Promise<RunRecord> {
    run.status = 'running'
    const perRun = manifest.budgets.per_run_defaults

    for (const step of pipeline.steps) {
      if (step.id in run.checkpoints) continue // resumability: done is done

      this.journal(run, step.id, 'step_started', '')
      const ctx = this.stepContext(run, manifest, step.id, perRun)
      try {
        const output = await step.run(ctx)
        run.checkpoints[step.id] = output
        this.journal(run, step.id, 'step_completed', '')
        await this.store.save(run)
      } catch (err) {
        if (err instanceof GateBlockedSignal) {
          run.status = 'awaiting_approval'
          await this.store.save(run)
          return run
        }
        if (err instanceof GateRejectedSignal) {
          run.status = 'rejected'
          this.journal(run, step.id, 'run_rejected', `gate ${err.gateId} rejected`)
          await this.store.save(run)
          return run
        }
        if (err instanceof BudgetExceededError) {
          run.status = 'failed'
          this.journal(run, step.id, 'budget_exceeded', err.message)
          this.journal(run, step.id, 'run_failed', 'budget exceeded')
          await this.store.save(run)
          return run
        }
        run.status = 'failed'
        this.journal(run, step.id, 'step_failed', (err as Error).message)
        this.journal(run, step.id, 'run_failed', (err as Error).message)
        await this.store.save(run)
        return run
      }
    }

    run.status = 'completed'
    this.journal(run, null, 'run_completed', '')
    await this.store.save(run)
    return run
  }

  private stepContext(
    run: RunRecord,
    manifest: ClientManifest,
    stepId: string,
    perRun: { max_clay_credits: number | null; max_tokens_usd: number | null },
  ): StepContext {
    const journal = (entry: JournalEntry['event'], detail: string) => this.journal(run, stepId, entry, detail)
    return {
      clientId: run.clientId,
      runId: run.runId,
      manifest,
      outputs: run.checkpoints,
      spendCredits: (n, why) => {
        assertSpend(n, 'clay credits')
        const next = run.spend.clayCredits + n
        if (perRun.max_clay_credits !== null && next > perRun.max_clay_credits) {
          throw new BudgetExceededError(
            `clay credits ${next} exceed per-run cap ${perRun.max_clay_credits}`,
          )
        }
        run.spend.clayCredits = next
        journal('budget_spent', `${n} credits: ${why}`)
      },
      spendTokensUsd: (n, why) => {
        assertSpend(n, 'token spend')
        const next = run.spend.tokensUsd + n
        if (perRun.max_tokens_usd !== null && next > perRun.max_tokens_usd) {
          throw new BudgetExceededError(
            `token spend $${next.toFixed(4)} exceeds per-run cap $${perRun.max_tokens_usd}`,
          )
        }
        run.spend.tokensUsd = next
        journal('budget_spent', `$${n.toFixed(4)} tokens: ${why}`)
      },
      gate: async (outputClass, payload) => {
        const gateId = `${stepId}:${outputClass}`
        const existing = run.gates.find((g) => g.id === gateId)
        if (existing) {
          if (existing.status === 'approved') return
          if (existing.status === 'rejected') throw new GateRejectedSignal(gateId)
          throw new GateBlockedSignal(gateId) // still pending
        }
        const policy = manifest.policies.approval[outputClass] ?? 'block'
        const record: GateRecord = {
          id: gateId,
          step: stepId,
          outputClass,
          payload,
          status: 'pending',
          resolvedBy: null,
          resolvedAt: null,
        }
        run.gates.push(record)
        journal('gate_opened', `${outputClass} (policy: ${policy})`)
        throw new GateBlockedSignal(gateId)
      },
    }
  }

  private journal(run: RunRecord, step: string | null, event: JournalEntry['event'], detail: string): void {
    run.journal.push({ at: this.now().toISOString(), step, event, detail })
    run.updatedAt = this.now().toISOString()
  }
}

function assertSpend(n: number, label: string): void {
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label} must be a finite non-negative number`)
}
