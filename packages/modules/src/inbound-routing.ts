import { listEnricher, router } from '@sartre/skills'
import type { PipelineDefinition } from '@sartre/pipelines'
import { resolveClientDeps } from './client-deps.js'
import type { ClientDeps } from './client-deps.js'

/**
 * marketing.inbound — aggregate → enrich → score/route → CRM-WRITE GATE →
 * writeback. Enrichment goes through the portfolio cache first (credits are
 * budget-tracked); routing is the deterministic Router with reasoning; the
 * write gate shows the GTME exactly which owner each lead gets and why.
 */

export interface InboundRoutingDeps {
  pullNewLeads(): Promise<(listEnricher.EnricherRow & { raw: Record<string, string | number | boolean | null> })[]>
  enrichment: listEnricher.EnricherDeps
  fieldsWanted: string[]
  clayCreditsPerProviderCall: number
  routingRules: router.RoutingRules
  /** Merge raw lead fields + enriched values into the router's input fields. */
  toRoutingFields(
    lead: { id: string; raw: Record<string, string | number | boolean | null> },
    enriched: listEnricher.EnrichedRow,
  ): Record<string, string | number | boolean | null>
  /** Namespaced CRM writeback; returns count written. */
  writeAssignments(assignments: { id: string; owner: string; reasoning: string }[]): Promise<number>
}

export function buildInboundRoutingPipeline(source: ClientDeps<InboundRoutingDeps>): PipelineDefinition {
  return {
    id: 'inbound-routing@0.1.0',
    moduleId: 'marketing.inbound',
    steps: [
      {
        id: 'pull',
        run: async (ctx) => (await resolveClientDeps(source, ctx.clientId)).pullNewLeads(),
      },
      {
        id: 'enrich',
        run: async (ctx) => {
          const deps = await resolveClientDeps(source, ctx.clientId)
          const leads = ctx.outputs.pull as Awaited<ReturnType<InboundRoutingDeps['pullNewLeads']>>
          if (!Number.isFinite(deps.clayCreditsPerProviderCall) || deps.clayCreditsPerProviderCall <= 0) {
            throw new Error('clayCreditsPerProviderCall must be a finite positive number')
          }
          const creditCap = ctx.manifest.budgets.per_run_defaults.max_clay_credits
          const result = await listEnricher.enrichList(leads, deps.enrichment, {
            fields: deps.fieldsWanted,
            maxProviderCalls: creditCap === null ? null : Math.floor(creditCap / deps.clayCreditsPerProviderCall),
          })
          if (result.providerCalls > 0) {
            ctx.spendCredits(result.providerCalls * deps.clayCreditsPerProviderCall, `enriched ${result.providerCalls} leads via provider`)
          }
          return result
        },
      },
      {
        id: 'route',
        run: async (ctx) => {
          const deps = await resolveClientDeps(source, ctx.clientId)
          const leads = ctx.outputs.pull as Awaited<ReturnType<InboundRoutingDeps['pullNewLeads']>>
          const enriched = (ctx.outputs.enrich as listEnricher.EnrichListResult).rows
          const enrichedById = new Map(enriched.map((e) => [e.id, e]))
          const decisions = leads.map((lead) =>
            router.route(
              { id: lead.id, fields: deps.toRoutingFields(lead, enrichedById.get(lead.id)!) },
              deps.routingRules,
            ),
          )
          return {
            assigned: decisions.filter((d) => d.decision === 'assigned'),
            manualReview: decisions.filter((d) => d.decision === 'manual_review'),
            skipped: decisions.filter((d) => d.decision === 'skip'),
          }
        },
      },
      {
        id: 'writeback',
        run: async (ctx) => {
          const deps = await resolveClientDeps(source, ctx.clientId)
          const { assigned, manualReview, skipped } = ctx.outputs.route as {
            assigned: router.RoutingDecision[]
            manualReview: router.RoutingDecision[]
            skipped: router.RoutingDecision[]
          }
          const assignments = assigned.map((d) => ({ id: d.id, owner: d.owner as string, reasoning: d.reasoning }))
          await ctx.gate('crm_write', {
            assignments,
            manualReview: manualReview.map((d) => ({ id: d.id, reasoning: d.reasoning })),
            skippedCount: skipped.length,
          })
          const written = await deps.writeAssignments(assignments)
          return { written, manualReview: manualReview.length, skipped: skipped.length }
        },
      },
    ],
  }
}
