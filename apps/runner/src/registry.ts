import { MapRegistry } from '@sartre/pipelines'

/**
 * Production pipeline registry. Pipeline builders live in @sartre/modules
 * (buildEnrichmentRefreshPipeline, buildReactivationPipeline,
 * buildInboundRoutingPipeline) — each takes its dependencies (connector
 * adapters, LLM client, brain-derived config) and returns a
 * PipelineDefinition. Registration happens here once those dependencies are
 * wired for a deployment; an empty registry is safe (the runner warns when a
 * schedule fires or a resume lands with no registered pipeline).
 *
 * Example wiring (when connector adapters exist for the deployment):
 *   import { buildEnrichmentRefreshPipeline } from '@sartre/modules'
 *   registry.register(buildEnrichmentRefreshPipeline({ pullAccounts, ... }))
 */
export function buildRegistry(): MapRegistry {
  return new MapRegistry()
}
