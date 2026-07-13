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
  enrichment: EnrichmentRefreshDeps
  /** The runner injects the production LLM; deployments cannot replace it. */
  reactivation: Omit<ReactivationDeps, 'llm'>
  inbound: InboundRoutingDeps
}

/**
 * Production pipeline registry. Dependencies are required: starting with an
 * empty registry would accept schedules but strand every run at resume time.
 */
export function buildRegistry(deps: RunnerModuleDeps, llm: LlmClient): MapRegistry {
  return new MapRegistry()
    .register(buildEnrichmentRefreshPipeline(deps.enrichment))
    .register(buildReactivationPipeline({ ...deps.reactivation, llm }))
    .register(buildInboundRoutingPipeline(deps.inbound))
}
