import { HumanActionEvent, OutcomeEvent } from '@sartre/core'
import type { FeedbackEvent, OutcomeEvent as OutcomeEventType } from '@sartre/core'
import {
  aggregateOutcomes,
  extractExemplars,
  gateProposals,
  proposeTuning,
  recalibrateIcp,
  renderAllocationReport,
  renderCalibrationReport,
  renderTuningReport,
  seededRng,
  thompsonAllocate,
} from '@sartre/learning'
import type { GradedOutcome, TuningProposal } from '@sartre/learning'
import type { PipelineDefinition } from '@sartre/pipelines'
import { resolveClientDeps } from './client-deps.js'
import type { ClientDeps } from './client-deps.js'

export interface LearningDraft {
  kind: 'exemplar' | 'tuning_report' | 'allocation_report' | 'calibration_report'
  slug: string
  target: string
  content: string
  sourceEventIds: string[]
}

export interface OptimizationInput {
  outcomes: OutcomeEventType[]
  /** Deployment-owned attribution from outcome id to an already-approved variant id. */
  variantByEventId: Record<string, string>
  gradedOutcomes: GradedOutcome[]
}

export interface LearningLoopDeps {
  loadFeedback(clientId: string): Promise<FeedbackEvent[]>
  /** Runs the relevant known-answer eval set with the proposed rule applied. */
  evaluateProposal(clientId: string, proposal: TuningProposal): Promise<{ pass: boolean; detail: string }>
  loadOptimizationInput(clientId: string): Promise<OptimizationInput>
  evaluateOptimizationDraft(clientId: string, draft: LearningDraft): Promise<{ pass: boolean; detail: string }>
  /** Idempotently stores draft artifacts after approval; it must never activate or apply them. */
  persistDrafts(clientId: string, drafts: LearningDraft[]): Promise<number>
  now?: () => Date
}

interface LearningReview {
  drafts: LearningDraft[]
  evalFailures: { kind: 'tuning' | 'optimization'; subject: unknown; detail: string }[]
  metricsOnlyCorrections: number
}

/** platform.learning speeds 1–2 — feedback → evaluated drafts → HUMAN BRAIN-CHANGE GATE. */
export function buildLearningLoopPipeline(source: ClientDeps<LearningLoopDeps>): PipelineDefinition {
  return {
    id: 'learning-loop@0.1.0',
    moduleId: 'platform.learning',
    steps: [
      {
        id: 'load',
        run: async (ctx) => (await resolveClientDeps(source, ctx.clientId)).loadFeedback(ctx.clientId),
      },
      {
        id: 'prepare',
        run: async (ctx) => {
          const deps = await resolveClientDeps(source, ctx.clientId)
          const feedback = (ctx.outputs.load as FeedbackEvent[])
          const events = feedback
            .filter((event) => event.kind === 'human_action')
            .map((event) => HumanActionEvent.parse(event))
          if (events.some((event) => event.clientId !== ctx.clientId)) {
            throw new Error('learning feedback crosses the client boundary')
          }
          const policy = ctx.manifest.policies.learning
          if (!policy.capture) {
            return { drafts: [], evalFailures: [], metricsOnlyCorrections: 0 } satisfies LearningReview
          }
          const date = (deps.now ?? (() => new Date()))().toISOString().slice(0, 10)
          const exemplars = policy.exemplar_memory ? extractExemplars(events, ctx.clientId) : []
          const proposed = policy.weekly_tuning ? proposeTuning(events) : []
          const evaluated = await gateProposals(proposed, (proposal) => deps.evaluateProposal(ctx.clientId, proposal))
          const passing = evaluated.filter((proposal) => proposal.evalResult.pass)
          const evalFailures: LearningReview['evalFailures'] = evaluated
            .filter((proposal) => !proposal.evalResult.pass)
            .map(({ evalResult, ...proposal }) => ({ kind: 'tuning' as const, subject: proposal, detail: evalResult.detail }))
          const drafts: LearningDraft[] = exemplars.map((exemplar) => ({
            kind: 'exemplar',
            slug: exemplar.slug,
            target: `brain/learned/exemplars/${exemplar.slug}.md`,
            content: exemplar.markdown,
            sourceEventIds: [exemplar.sourceEventId],
          }))
          if (passing.length > 0) {
            const sourceEventIds = [...new Set(passing.flatMap((proposal) => proposal.evidence.eventIds))]
            drafts.push({
              kind: 'tuning_report',
              slug: `weekly-tuning-${date}`,
              target: `brain/learned/weekly-tuning-${date}.md`,
              content: renderDraftTuningReport(ctx.clientId, date, passing, sourceEventIds),
              sourceEventIds,
            })
          }
          if (policy.outcome_optimization) {
            const optimization = await deps.loadOptimizationInput(ctx.clientId)
            const outcomes = optimization.outcomes.map((event) => OutcomeEvent.parse(event))
            if (outcomes.some((event) => event.clientId !== ctx.clientId)) {
              throw new Error('optimization outcomes cross the client boundary')
            }
            const optimizationDrafts = buildOptimizationDrafts(ctx.clientId, date, {
              ...optimization,
              outcomes,
            })
            for (const draft of optimizationDrafts) {
              const result = await deps.evaluateOptimizationDraft(ctx.clientId, draft)
              if (result.pass) drafts.push(draft)
              else evalFailures.push({ kind: 'optimization', subject: draft, detail: result.detail })
            }
          }
          const reasoned = new Set(exemplars.map((exemplar) => exemplar.sourceEventId))
          const correctionActions = new Set(['approve_with_edit', 'reject', 'grade_override', 'routing_correction', 'list_removal'])
          const metricsOnlyCorrections = events.filter((event) => correctionActions.has(event.action) && !reasoned.has(event.id)).length
          return { drafts, evalFailures, metricsOnlyCorrections } satisfies LearningReview
        },
      },
      {
        id: 'review',
        run: async (ctx) => {
          const review = ctx.outputs.prepare as LearningReview
          if (review.drafts.length > 0) {
            await ctx.gate('brain_change', review)
          } else if (review.evalFailures.length > 0) {
            await ctx.gate('internal_report', review)
          }
          return review
        },
      },
      {
        id: 'persist',
        run: async (ctx) => {
          const deps = await resolveClientDeps(source, ctx.clientId)
          const { drafts } = ctx.outputs.prepare as LearningReview
          const persisted = drafts.length === 0 ? 0 : await deps.persistDrafts(ctx.clientId, drafts)
          return { persisted, drafts: drafts.length }
        },
      },
    ],
  }
}

function buildOptimizationDrafts(clientId: string, date: string, input: OptimizationInput): LearningDraft[] {
  const drafts: LearningDraft[] = []
  const stats = aggregateOutcomes(input.outcomes, (event) => input.variantByEventId[event.id] ?? null)
  if (stats.length >= 2) {
    const allocations = thompsonAllocate(stats, { rng: seededRng(seedFor(`${clientId}:${date}:allocation`)) })
    const sourceEventIds = input.outcomes
      .filter((event) => input.variantByEventId[event.id] !== undefined)
      .map((event) => event.id)
    drafts.push({
      kind: 'allocation_report',
      slug: `outcome-allocation-${date}`,
      target: `brain/learned/outcome-allocation-${date}.md`,
      content: draftEnvelope(clientId, date, sourceEventIds.map((id) => `outcome-event:${id}`), renderAllocationReport('approved variants', allocations)),
      sourceEventIds,
    })
  }
  const calibration = recalibrateIcp(input.gradedOutcomes)
  if (calibration.proposals.length > 0) {
    const sourceEventIds = input.gradedOutcomes.map((outcome) => outcome.id)
    drafts.push({
      kind: 'calibration_report',
      slug: `icp-calibration-${date}`,
      target: `brain/learned/icp-calibration-${date}.md`,
      content: draftEnvelope(clientId, date, sourceEventIds.map((id) => `graded-outcome:${id}`), renderCalibrationReport(clientId, date, calibration)),
      sourceEventIds,
    })
  }
  return drafts
}

function renderDraftTuningReport(
  clientId: string,
  date: string,
  proposals: TuningProposal[],
  sourceEventIds: string[],
): string {
  return draftEnvelope(clientId, date, sourceEventIds.map((id) => `feedback-event:${id}`), renderTuningReport(clientId, date, proposals))
}

function draftEnvelope(clientId: string, date: string, sourceRefs: string[], body: string): string {
  return [
    '---',
    'brain_doc: learning-proposal',
    `client: ${clientId}`,
    'status: draft',
    `updated: ${date}`,
    `sources: [${sourceRefs.map((source) => `"${source}"`).join(', ')}]`,
    'approved_by: ""',
    '---',
    '',
    body,
  ].join('\n')
}

function seedFor(value: string): number {
  let seed = 2166136261
  for (const char of value) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619)
  return seed >>> 0
}
