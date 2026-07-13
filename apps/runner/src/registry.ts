import {
  buildEnrichmentRefreshPipeline,
  buildInboundRoutingPipeline,
  buildReactivationPipeline,
  buildRemediationPipeline,
  buildCopilotBriefsPipeline,
  buildDedupReviewPipeline,
  buildLeadConvertPipeline,
  buildDeanonPipeline,
  buildLearningLoopPipeline,
  buildQualityMonitorPipeline,
} from '@sartre/modules'
import type {
  CopilotBriefDeps,
  DedupReviewDeps,
  LeadConvertDeps,
  DeanonDeps,
  LearningLoopDeps,
  QualityMonitorDeps,
  EnrichmentRefreshDeps,
  InboundRoutingDeps,
  ReactivationDeps,
  RemediationDeps,
} from '@sartre/modules'
import { MapRegistry } from '@sartre/pipelines'
import type { LlmClient } from '@sartre/skills'

/** Deployment-owned adapters and brain-derived configuration for each module. */
export type RunnerEnrichmentDeps = EnrichmentRefreshDeps
  & Required<Pick<EnrichmentRefreshDeps, 'refreshCanonical'>>

export interface RunnerModuleDeps {
  enrichment(clientId: string): RunnerEnrichmentDeps | Promise<RunnerEnrichmentDeps>
  /** The runner injects the production LLM; deployments cannot replace it. */
  reactivation(clientId: string): Omit<ReactivationDeps, 'llm'> | Promise<Omit<ReactivationDeps, 'llm'>>
  inbound(clientId: string): InboundRoutingDeps | Promise<InboundRoutingDeps>
  remediation(clientId: string): RemediationDeps | Promise<RemediationDeps>
  /** The runner injects the production LLM; deployments cannot replace it. */
  copilotBriefs(clientId: string): Omit<CopilotBriefDeps, 'llm'> | Promise<Omit<CopilotBriefDeps, 'llm'>>
  dedup(clientId: string): DedupReviewDeps | Promise<DedupReviewDeps>
  leadConvert(clientId: string): LeadConvertDeps | Promise<LeadConvertDeps>
  deanon(clientId: string): DeanonDeps | Promise<DeanonDeps>
  learning(clientId: string): LearningLoopDeps | Promise<LearningLoopDeps>
  quality(clientId: string): QualityMonitorDeps | Promise<QualityMonitorDeps>
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
  const copilotBriefs = async (clientId: string): Promise<CopilotBriefDeps> => {
    const clientDeps = await deps.copilotBriefs(clientId)
    return { ...clientDeps, llm }
  }
  return new MapRegistry()
    .register(buildEnrichmentRefreshPipeline(deps.enrichment))
    .register(buildReactivationPipeline(reactivation))
    .register(buildInboundRoutingPipeline(deps.inbound))
    .register(buildRemediationPipeline(deps.remediation))
    .register(buildCopilotBriefsPipeline(copilotBriefs))
    .register(buildDedupReviewPipeline(deps.dedup))
    .register(buildLeadConvertPipeline(deps.leadConvert))
    .register(buildDeanonPipeline(deps.deanon))
    .register(buildLearningLoopPipeline(deps.learning))
    .register(buildQualityMonitorPipeline(deps.quality))
}
