import { copilotBrief } from '@sartre/skills'
import type { LlmClient } from '@sartre/skills'
import type { PipelineDefinition } from '@sartre/pipelines'
import { resolveClientDeps } from './client-deps.js'
import type { ClientDeps } from './client-deps.js'

export interface CopilotBriefDeps {
  /** Canonical account/opportunity/activity evidence plus approved client Brain context. */
  loadBriefInputs(clientId: string): Promise<copilotBrief.CopilotBriefInput[]>
  llm: LlmClient
  tokenUsdPerBrief: number
  /** Internal GTME delivery only; runs after the structural report gate. */
  publishBriefs(clientId: string, briefs: copilotBrief.CopilotBrief[]): Promise<number>
}

export interface CopilotBriefBatch {
  briefs: copilotBrief.CopilotBrief[]
  failed: { accountId: string; problem: string }[]
}

/** sales.copilot-briefs — canonical context → grounded drafts → HUMAN GATE → internal delivery. */
export function buildCopilotBriefsPipeline(source: ClientDeps<CopilotBriefDeps>): PipelineDefinition {
  return {
    id: 'copilot-briefs@0.1.0',
    moduleId: 'sales.copilot-briefs',
    steps: [
      {
        id: 'load',
        run: async (ctx) => (await resolveClientDeps(source, ctx.clientId)).loadBriefInputs(ctx.clientId),
      },
      {
        id: 'budget',
        run: async (ctx) => {
          const deps = await resolveClientDeps(source, ctx.clientId)
          const inputs = ctx.outputs.load as copilotBrief.CopilotBriefInput[]
          if (!Number.isFinite(deps.tokenUsdPerBrief) || deps.tokenUsdPerBrief <= 0) {
            throw new Error('tokenUsdPerBrief must be a finite positive number')
          }
          const estimated = inputs.length * deps.tokenUsdPerBrief
          ctx.spendTokensUsd(estimated, `reserved ${inputs.length} copilot brief drafts`)
          return { briefs: inputs.length, estimatedTokensUsd: estimated }
        },
      },
      {
        id: 'generate',
        run: async (ctx) => {
          const deps = await resolveClientDeps(source, ctx.clientId)
          const inputs = ctx.outputs.load as copilotBrief.CopilotBriefInput[]
          const result: CopilotBriefBatch = { briefs: [], failed: [] }
          for (const input of inputs) {
            try {
              result.briefs.push(await copilotBrief.generateCopilotBrief(input, deps.llm))
            } catch (error) {
              result.failed.push({ accountId: input.accountId, problem: (error as Error).message })
            }
          }
          return result
        },
      },
      {
        id: 'review',
        run: async (ctx) => {
          const batch = ctx.outputs.generate as CopilotBriefBatch
          if (batch.briefs.length === 0 && batch.failed.length === 0) return { action: 'none' }
          await ctx.gate('internal_report', batch)
          return batch
        },
      },
      {
        id: 'publish',
        run: async (ctx) => {
          const deps = await resolveClientDeps(source, ctx.clientId)
          const batch = ctx.outputs.generate as CopilotBriefBatch
          const published = batch.briefs.length === 0
            ? 0
            : await deps.publishBriefs(ctx.clientId, batch.briefs)
          return { published, failed: batch.failed.length }
        },
      },
    ],
  }
}
