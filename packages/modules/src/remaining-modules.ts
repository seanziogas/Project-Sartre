import type { GateRecord, PipelineDefinition } from '@sartre/pipelines'
import { resolveClientDeps } from './client-deps.js'
import type { ClientDeps } from './client-deps.js'

export interface ActionPlan {
  summary: string
  items: unknown[]
  metadata?: Record<string, unknown>
}

/**
 * Common boundary for modules whose provider-specific work belongs to the
 * deployment adapter. The pipeline owns checkpointing and the structural
 * human gate; execute() is unreachable until that gate is approved.
 */
export interface GatedActionDeps<TInput = unknown> {
  load(clientId: string): Promise<TInput>
  prepare(clientId: string, input: TInput): Promise<ActionPlan>
  execute(clientId: string, plan: ActionPlan): Promise<{ affected: number; detail?: string }>
}

export interface OutboundDeps extends GatedActionDeps {}
export interface AbmDeps extends GatedActionDeps {}
export interface TakeoutDeps extends GatedActionDeps {}
export interface RepWorkflowsDeps extends GatedActionDeps {}
export interface EventsDeps extends GatedActionDeps {}
export interface CopyFactoryDeps extends GatedActionDeps {}
export interface AdsSyncDeps extends GatedActionDeps {}
export interface RoutingDeps extends GatedActionDeps {}
export interface TamDeps extends GatedActionDeps {}
export interface EtlDeps extends GatedActionDeps {}
export interface SignalsDeps extends GatedActionDeps {}
export interface DigestsDeps extends GatedActionDeps {}
export interface MetricsDeps extends GatedActionDeps {}

function gatedActionPipeline<T>(
  id: string,
  moduleId: string,
  outputClass: GateRecord['outputClass'],
  source: ClientDeps<GatedActionDeps<T>>,
): PipelineDefinition {
  return {
    id,
    moduleId,
    steps: [
      { id: 'load', run: async (ctx) => (await resolveClientDeps(source, ctx.clientId)).load(ctx.clientId) },
      {
        id: 'prepare',
        run: async (ctx) => {
          const plan = await (await resolveClientDeps(source, ctx.clientId)).prepare(ctx.clientId, ctx.outputs.load as T)
          if (!plan.summary.trim() || !Array.isArray(plan.items)) throw new Error('action plan requires a summary and reviewable items')
          return plan
        },
      },
      {
        id: 'review',
        run: async (ctx) => {
          const plan = ctx.outputs.prepare as ActionPlan
          await ctx.gate(outputClass, plan)
          return { approvedPlan: plan }
        },
      },
      {
        id: 'execute',
        run: async (ctx) => {
          const plan = ctx.outputs.prepare as ActionPlan
          return (await resolveClientDeps(source, ctx.clientId)).execute(ctx.clientId, plan)
        },
      },
    ],
  }
}

/** sales.outbound — reviewed campaign/enrollment plan → outbound gate → sequencer dispatch. */
export function buildOutboundPipeline(source: ClientDeps<OutboundDeps>): PipelineDefinition {
  return gatedActionPipeline('outbound@0.1.0', 'sales.outbound', 'outbound_send', source)
}

/** sales.abm — reviewed account play plan → outbound gate → activation. */
export function buildAbmPipeline(source: ClientDeps<AbmDeps>): PipelineDefinition {
  return gatedActionPipeline('abm@0.1.0', 'sales.abm', 'outbound_send', source)
}

/** sales.takeout — reviewed competitive play → outbound gate → activation. */
export function buildTakeoutPipeline(source: ClientDeps<TakeoutDeps>): PipelineDefinition {
  return gatedActionPipeline('competitive-takeout@0.1.0', 'sales.takeout', 'outbound_send', source)
}

/** sales.rep-workflows — proposed CRM/handoff actions → CRM gate → write. */
export function buildRepWorkflowsPipeline(source: ClientDeps<RepWorkflowsDeps>): PipelineDefinition {
  return gatedActionPipeline('rep-workflows@0.1.0', 'sales.rep-workflows', 'crm_write', source)
}

/** marketing.events — attendee follow-up plan → outbound gate → dispatch. */
export function buildEventsPipeline(source: ClientDeps<EventsDeps>): PipelineDefinition {
  return gatedActionPipeline('event-followup@0.1.0', 'marketing.events', 'outbound_send', source)
}

/** marketing.copy-factory — campaign drafts → internal review gate → draft publication only. */
export function buildCopyFactoryPipeline(source: ClientDeps<CopyFactoryDeps>): PipelineDefinition {
  return gatedActionPipeline('copy-factory@0.1.0', 'marketing.copy-factory', 'internal_report', source)
}

/** marketing.ads-sync — proposed audience mutation → external-send gate → provider sync. */
export function buildAdsSyncPipeline(source: ClientDeps<AdsSyncDeps>): PipelineDefinition {
  return gatedActionPipeline('ads-audience-sync@0.1.0', 'marketing.ads-sync', 'outbound_send', source)
}

/** revops.routing — reviewed owner changes → CRM gate → namespaced writeback. */
export function buildRoutingPipeline(source: ClientDeps<RoutingDeps>): PipelineDefinition {
  return gatedActionPipeline('revops-routing@0.1.0', 'revops.routing', 'crm_write', source)
}

/** revops.tam — scored TAM annotations → CRM gate → namespaced writeback. */
export function buildTamPipeline(source: ClientDeps<TamDeps>): PipelineDefinition {
  return gatedActionPipeline('tam-mapping@0.1.0', 'revops.tam', 'crm_write', source)
}

/** revops.etl — reverse-ETL change set → CRM gate → destination write. */
export function buildEtlPipeline(source: ClientDeps<EtlDeps>): PipelineDefinition {
  return gatedActionPipeline('reporting-etl@0.1.0', 'revops.etl', 'crm_write', source)
}

/** platform.signals — matched signals/plays → internal gate → canonical trigger persistence. */
export function buildSignalsPipeline(source: ClientDeps<SignalsDeps>): PipelineDefinition {
  return gatedActionPipeline('signal-watcher@0.1.0', 'platform.signals', 'internal_report', source)
}

/** platform.digests — prepared digest → client-comms gate → delivery. */
export function buildDigestsPipeline(source: ClientDeps<DigestsDeps>): PipelineDefinition {
  return gatedActionPipeline('weekly-digests@0.1.0', 'platform.digests', 'client_comms', source)
}

/** platform.metrics — baseline/delta report → client-comms gate → publication. */
export function buildMetricsPipeline(source: ClientDeps<MetricsDeps>): PipelineDefinition {
  return gatedActionPipeline('metrics-reporting@0.1.0', 'platform.metrics', 'client_comms', source)
}
