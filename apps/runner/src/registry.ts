import {
  buildEnrichmentRefreshPipeline,
  buildInboundRoutingPipeline,
  buildReactivationPipeline,
} from '@sartre/modules'
import type {
  EnrichmentRefreshDeps,
  InboundRoutingDeps,
  ReactivationDeps,
} from '@sartre/modules'
import { MapRegistry } from '@sartre/pipelines'
import type { LlmClient } from '@sartre/skills'

/** Deployment-owned adapters and brain-derived configuration for each module. */
export interface RunnerModuleDeps {
  enrichment(clientId: string): EnrichmentRefreshDeps | Promise<EnrichmentRefreshDeps>
  /** The runner injects the production LLM; deployments cannot replace it. */
  reactivation(clientId: string): Omit<ReactivationDeps, 'llm'> | Promise<Omit<ReactivationDeps, 'llm'>>
  inbound(clientId: string): InboundRoutingDeps | Promise<InboundRoutingDeps>
}

/**
 * Production pipeline registry. Dependencies are required: starting with an
 * empty registry would accept schedules but strand every run at resume time.
 */
export function buildRegistry(deps: RunnerModuleDeps, llm: LlmClient): MapRegistry {
  const reactivation = async (clientId: string): Promise<ReactivationDeps> => {
    const clientDeps = await deps.reactivation(clientId)
    return { ...clientDeps, llm }
  }
  return new MapRegistry()
    .register(buildEnrichmentRefreshPipeline(deps.enrichment))
    .register(buildReactivationPipeline(reactivation))
    .register(buildInboundRoutingPipeline(deps.inbound))
}
