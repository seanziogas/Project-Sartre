import type { Account, Signal } from '@sartre/core'
import type { IntentEvent } from '@sartre/connectors'
import { buildCanonicalSignals, planDeanonMatches } from '@sartre/data'
import type { DeanonPlan } from '@sartre/data'
import type { PipelineDefinition } from '@sartre/pipelines'
import { resolveClientDeps } from './client-deps.js'
import type { ClientDeps } from './client-deps.js'

export interface DeanonInput {
  events: IntentEvent[]
  accounts: Account[]
}

export interface DeanonDeps {
  sourceSystem: string
  /** Pulls and stages the raw signal batch before returning normalized events and canonical accounts. */
  loadDeanonInput(clientId: string): Promise<DeanonInput>
  /** Canonical-only persistence. This boundary cannot route, send, or write CRM fields. */
  persistSignals(clientId: string, signals: Signal[]): Promise<number>
}

interface PreparedDeanonReview {
  plan: DeanonPlan
  signals: Signal[]
}

/** marketing.deanon — staged intent → exact-domain matches → HUMAN GATE → canonical signals. */
export function buildDeanonPipeline(source: ClientDeps<DeanonDeps>): PipelineDefinition {
  return {
    id: 'deanon@0.1.0',
    moduleId: 'marketing.deanon',
    steps: [
      {
        id: 'load',
        run: async (ctx) => (await resolveClientDeps(source, ctx.clientId)).loadDeanonInput(ctx.clientId),
      },
      {
        id: 'prepare',
        run: async (ctx) => {
          const deps = await resolveClientDeps(source, ctx.clientId)
          const input = ctx.outputs.load as DeanonInput
          if (!deps.sourceSystem.trim() || input.events.some((event) => event.sourceSystem !== deps.sourceSystem)) {
            throw new Error('intent events do not match the configured deanon source system')
          }
          const plan = planDeanonMatches(ctx.clientId, input.events, input.accounts)
          const signals = buildCanonicalSignals(ctx.clientId, plan, { runId: ctx.runId })
          return { plan, signals } satisfies PreparedDeanonReview
        },
      },
      {
        id: 'review',
        run: async (ctx) => {
          const prepared = ctx.outputs.prepare as PreparedDeanonReview
          if (prepared.plan.decisions.length === 0) return { action: 'none' }
          await ctx.gate('internal_report', prepared)
          return prepared
        },
      },
      {
        id: 'persist',
        run: async (ctx) => {
          const deps = await resolveClientDeps(source, ctx.clientId)
          const { signals } = ctx.outputs.prepare as PreparedDeanonReview
          const persisted = signals.length === 0 ? 0 : await deps.persistSignals(ctx.clientId, signals)
          return { persisted, reviewed: signals.length }
        },
      },
    ],
  }
}
