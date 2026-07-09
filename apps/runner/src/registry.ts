import { MapRegistry } from '@sartre/pipelines'

/**
 * Production pipeline registry. As module pipelines ship (Phase 3), they
 * register here — pipeline definitions compose skills from @sartre/skills
 * into module workflows. An empty registry is safe: the runner warns when a
 * schedule fires or a run needs resuming with no registered pipeline.
 */
export function buildRegistry(): MapRegistry {
  const registry = new MapRegistry()
  // e.g. registry.register(enrichmentRefreshPipeline)
  //      registry.register(closedLostReactivationPipeline)
  return registry
}
