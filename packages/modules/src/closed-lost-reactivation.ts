import { campaignFactory, listGrader } from '@sartre/skills'
import type { LlmClient } from '@sartre/skills'
import type { PipelineDefinition } from '@sartre/pipelines'

/**
 * sales.reactivation — closed-lost reactivation (the proven Hologram
 * campaign, as a module workflow): grade the closed-lost book (LLM with
 * adversarial review) → assign plays deterministically → deterministic
 * campaign factory → OUTBOUND GATE → enroll. The gate payload carries the
 * coverage-prioritized review sample, mirroring the manual campaign-review
 * deck.
 */

export interface ReactivationDeps {
  pullClosedLost(): Promise<listGrader.GraderRow[]>
  graderConfig: listGrader.GraderConfig
  llm: LlmClient
  /** Estimated token cost per graded row, for budget tracking. */
  tokenUsdPerRow: number
  /** Grades below this score are not reactivated. */
  minScore: number
  /** Deterministic play assignment from the grade (brain rules, not vibes). */
  playFor(grade: listGrader.Grade): { play: string; group: string; slots: Record<string, string | null>; tier?: string; doNotContact?: boolean }
  templates: campaignFactory.CampaignTemplates
  /** Sequencer enrollment; returns count enrolled. */
  enroll(rows: { id: string; emails: [campaignFactory.GeneratedEmail, campaignFactory.GeneratedEmail, campaignFactory.GeneratedEmail] }[]): Promise<number>
}

export function buildReactivationPipeline(deps: ReactivationDeps): PipelineDefinition {
  return {
    id: 'closed-lost-reactivation@0.1.0',
    moduleId: 'sales.reactivation',
    steps: [
      {
        id: 'grade',
        run: async (ctx) => {
          const rows = await deps.pullClosedLost()
          // Reserve the configured estimate before making any paid calls so a
          // run that cannot fit its budget never reaches the model.
          ctx.spendTokensUsd(rows.length * deps.tokenUsdPerRow, `graded ${rows.length} closed-lost accounts`)
          const result = await listGrader.gradeList(rows, deps.graderConfig, deps.llm)
          return result
        },
      },
      {
        id: 'select',
        run: async (ctx) => {
          const { grades, ungraded } = ctx.outputs.grade as listGrader.GradeListResult
          const selected = grades.filter((g) => g.score >= deps.minScore)
          const campaignRows = selected.map((g) => ({ id: g.id, ...deps.playFor(g) }))
          return { campaignRows, selected: selected.length, skipped: grades.length - selected.length, ungraded }
        },
      },
      {
        id: 'draft',
        run: async (ctx) => {
          const { campaignRows } = ctx.outputs.select as { campaignRows: campaignFactory.CampaignRow[] }
          const campaign = campaignFactory.generateCampaign(campaignRows, deps.templates)
          const sample = campaign.rows.filter((r) => campaign.reviewSampleIds.includes(r.id))
          // the gate payload IS the review deck: sample + counts, not the raw dump
          await ctx.gate('outbound_send', {
            totalRows: campaign.rows.length,
            skippedDnc: campaign.skippedDnc,
            reviewSample: sample,
          })
          return campaign
        },
      },
      {
        id: 'enroll',
        run: async (ctx) => {
          const campaign = ctx.outputs.draft as campaignFactory.CampaignResult
          const sendable = campaign.rows
            .filter((r): r is typeof r & { emails: NonNullable<typeof r.emails> } => r.emails !== null)
            .map((r) => ({ id: r.id, emails: r.emails }))
          const enrolled = await deps.enroll(sendable)
          return { enrolled }
        },
      },
    ],
  }
}
