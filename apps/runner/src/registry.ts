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
  buildOutboundPipeline,
  buildAbmPipeline,
  buildTakeoutPipeline,
  buildRepWorkflowsPipeline,
  buildEventsPipeline,
  buildCopyFactoryPipeline,
  buildAdsSyncPipeline,
  buildRoutingPipeline,
  buildTamPipeline,
  buildEtlPipeline,
  buildSignalsPipeline,
  buildDigestsPipeline,
  buildMetricsPipeline,
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
  OutboundDeps,
  AbmDeps,
  TakeoutDeps,
  RepWorkflowsDeps,
  EventsDeps,
  CopyFactoryDeps,
  AdsSyncDeps,
  RoutingDeps,
  TamDeps,
  EtlDeps,
  SignalsDeps,
  DigestsDeps,
  MetricsDeps,
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
  outbound(clientId: string): OutboundDeps | Promise<OutboundDeps>
  abm(clientId: string): AbmDeps | Promise<AbmDeps>
  takeout(clientId: string): TakeoutDeps | Promise<TakeoutDeps>
  /** The runner injects the production LLM; deployments cannot replace it. */
  repWorkflows(clientId: string): Omit<RepWorkflowsDeps, 'llm'> | Promise<Omit<RepWorkflowsDeps, 'llm'>>
  events(clientId: string): EventsDeps | Promise<EventsDeps>
  copyFactory(clientId: string): CopyFactoryDeps | Promise<CopyFactoryDeps>
  adsSync(clientId: string): AdsSyncDeps | Promise<AdsSyncDeps>
  routing(clientId: string): RoutingDeps | Promise<RoutingDeps>
  tam(clientId: string): TamDeps | Promise<TamDeps>
  etl(clientId: string): EtlDeps | Promise<EtlDeps>
  signals(clientId: string): SignalsDeps | Promise<SignalsDeps>
  digests(clientId: string): DigestsDeps | Promise<DigestsDeps>
  /** The runner injects the production LLM; deployments cannot replace it. */
  metrics(clientId: string): Omit<MetricsDeps, 'llm'> | Promise<Omit<MetricsDeps, 'llm'>>
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
  const repWorkflows = async (clientId: string): Promise<RepWorkflowsDeps> => ({ ...await deps.repWorkflows(clientId), llm })
  const metrics = async (clientId: string): Promise<MetricsDeps> => ({ ...await deps.metrics(clientId), llm })
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
    .register(buildOutboundPipeline(deps.outbound))
    .register(buildAbmPipeline(deps.abm))
    .register(buildTakeoutPipeline(deps.takeout))
    .register(buildRepWorkflowsPipeline(repWorkflows))
    .register(buildEventsPipeline(deps.events))
    .register(buildCopyFactoryPipeline(deps.copyFactory))
    .register(buildAdsSyncPipeline(deps.adsSync))
    .register(buildRoutingPipeline(deps.routing))
    .register(buildTamPipeline(deps.tam))
    .register(buildEtlPipeline(deps.etl))
    .register(buildSignalsPipeline(deps.signals))
    .register(buildDigestsPipeline(deps.digests))
    .register(buildMetricsPipeline(metrics))
}
