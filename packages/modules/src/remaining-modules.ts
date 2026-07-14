import type { GateRecord, PipelineDefinition } from '@sartre/pipelines'
import {
  campaignFactory,
  replyHandler,
  router,
  signalWatcher,
  sowQbrGenerator,
} from '@sartre/skills'
import type { LlmClient } from '@sartre/skills'
import { resolveClientDeps } from './client-deps.js'
import type { ClientDeps } from './client-deps.js'

export interface DispatchReceipt { affected: number; detail?: string }
export interface ReviewPlan<T> { summary: string; items: T[]; metadata?: Record<string, unknown> }

function requirePlan<T>(plan: ReviewPlan<T>, name: string): ReviewPlan<T> {
  if (!plan.summary.trim() || !Array.isArray(plan.items)) throw new Error(`${name} requires a summary and reviewable items`)
  return plan
}

function reviewedPipeline<TInput, TPlan extends ReviewPlan<unknown>>(
  id: string,
  moduleId: string,
  outputClass: GateRecord['outputClass'],
  source: ClientDeps<{ load(clientId: string): Promise<TInput>; prepare(clientId: string, input: TInput): Promise<TPlan>; execute(clientId: string, plan: TPlan): Promise<DispatchReceipt> }>,
  label: string,
): PipelineDefinition {
  return {
    id,
    moduleId,
    steps: [
      { id: 'load', run: async (ctx) => (await resolveClientDeps(source, ctx.clientId)).load(ctx.clientId) },
      {
        id: 'prepare',
        run: async (ctx) => requirePlan(
          await (await resolveClientDeps(source, ctx.clientId)).prepare(ctx.clientId, ctx.outputs.load as TInput),
          label,
        ),
      },
      { id: 'review', run: async (ctx) => { const plan = ctx.outputs.prepare as TPlan; await ctx.gate(outputClass, plan); return plan } },
      { id: 'execute', effect: true, run: async (ctx) => (await resolveClientDeps(source, ctx.clientId)).execute(ctx.clientId, ctx.outputs.prepare as TPlan) },
    ],
  }
}

// sales.outbound ------------------------------------------------------------
export interface OutboundInput { rows: campaignFactory.CampaignRow[] }
export interface OutboundPlan extends ReviewPlan<campaignFactory.GeneratedRow> {
  campaign: campaignFactory.CampaignResult
}
export interface OutboundDeps {
  loadCandidates(clientId: string): Promise<OutboundInput>
  templates: campaignFactory.CampaignTemplates
  enroll(clientId: string, rows: campaignFactory.GeneratedRow[]): Promise<DispatchReceipt>
}
export function buildOutboundPipeline(source: ClientDeps<OutboundDeps>): PipelineDefinition {
  return {
    id: 'outbound@0.1.0', moduleId: 'sales.outbound', steps: [
      { id: 'load', run: async (ctx) => (await resolveClientDeps(source, ctx.clientId)).loadCandidates(ctx.clientId) },
      { id: 'draft', run: async (ctx) => {
        const deps = await resolveClientDeps(source, ctx.clientId)
        const campaign = campaignFactory.generateCampaign((ctx.outputs.load as OutboundInput).rows, deps.templates)
        const reviewIds = new Set(campaign.reviewSampleIds)
        const plan: OutboundPlan = {
          summary: `${campaign.rows.length - campaign.skippedDnc} outbound drafts; ${campaign.skippedDnc} DNC records excluded`,
          items: campaign.rows.filter((row) => reviewIds.has(row.id)), campaign,
        }
        requirePlan(plan, 'outbound plan')
        return plan
      } },
      { id: 'review', run: async (ctx) => { const plan = ctx.outputs.draft as OutboundPlan; await ctx.gate('outbound_send', plan); return plan } },
      { id: 'enroll', effect: true, run: async (ctx) => {
        const deps = await resolveClientDeps(source, ctx.clientId)
        const plan = ctx.outputs.draft as OutboundPlan
        return deps.enroll(ctx.clientId, plan.campaign.rows.filter((row) => row.emails !== null))
      } },
    ],
  }
}

// sales.abm / sales.takeout -------------------------------------------------
export interface AccountPlay { accountId: string; accountName: string; play: string; rationale: string; contacts: string[] }
export interface AbmInput { accounts: Array<{ id: string; name: string; fields: Record<string, unknown> }> }
export interface AbmDeps {
  loadAccounts(clientId: string): Promise<AbmInput>
  planAccount(clientId: string, account: AbmInput['accounts'][number]): AccountPlay | null
  activate(clientId: string, plays: AccountPlay[]): Promise<DispatchReceipt>
}
export function buildAbmPipeline(source: ClientDeps<AbmDeps>): PipelineDefinition {
  return {
    id: 'abm@0.1.0', moduleId: 'sales.abm', steps: [
      { id: 'load', run: async (ctx) => (await resolveClientDeps(source, ctx.clientId)).loadAccounts(ctx.clientId) },
      { id: 'plan', run: async (ctx) => { const deps = await resolveClientDeps(source, ctx.clientId); const items = (ctx.outputs.load as AbmInput).accounts.map((a) => deps.planAccount(ctx.clientId, a)).filter((x): x is AccountPlay => x !== null); return requirePlan({ summary: `${items.length} account plays`, items }, 'ABM plan') } },
      { id: 'review', run: async (ctx) => { const plan = ctx.outputs.plan as ReviewPlan<AccountPlay>; await ctx.gate('outbound_send', plan); return plan } },
      { id: 'activate', effect: true, run: async (ctx) => (await resolveClientDeps(source, ctx.clientId)).activate(ctx.clientId, (ctx.outputs.plan as ReviewPlan<AccountPlay>).items) },
    ],
  }
}

export interface TakeoutCandidate { accountId: string; accountName: string; competitor: string; evidence: string[] }
export interface TakeoutPlay extends TakeoutCandidate { angle: string; proof: string; draft: string }
export interface TakeoutDeps {
  loadCandidates(clientId: string): Promise<TakeoutCandidate[]>
  preparePlay(clientId: string, candidate: TakeoutCandidate): TakeoutPlay | null
  activate(clientId: string, plays: TakeoutPlay[]): Promise<DispatchReceipt>
}
export function buildTakeoutPipeline(source: ClientDeps<TakeoutDeps>): PipelineDefinition {
  return {
    id: 'competitive-takeout@0.1.0', moduleId: 'sales.takeout', steps: [
      { id: 'load', run: async (ctx) => (await resolveClientDeps(source, ctx.clientId)).loadCandidates(ctx.clientId) },
      { id: 'prepare', run: async (ctx) => { const deps = await resolveClientDeps(source, ctx.clientId); const items = (ctx.outputs.load as TakeoutCandidate[]).map((c) => deps.preparePlay(ctx.clientId, c)).filter((x): x is TakeoutPlay => x !== null); return requirePlan({ summary: `${items.length} competitive takeout plays`, items }, 'takeout plan') } },
      { id: 'review', run: async (ctx) => { const plan = ctx.outputs.prepare as ReviewPlan<TakeoutPlay>; await ctx.gate('outbound_send', plan); return plan } },
      { id: 'activate', effect: true, run: async (ctx) => (await resolveClientDeps(source, ctx.clientId)).activate(ctx.clientId, (ctx.outputs.prepare as ReviewPlan<TakeoutPlay>).items) },
    ],
  }
}

// sales.rep-workflows -------------------------------------------------------
export interface RepWorkflowInput { replies: Array<{ id: string; sender: string; message: string }>; crmActions: Array<{ id: string; action: string; detail: string }> }
export interface RepWorkflowPlan extends ReviewPlan<{ id: string; kind: 'reply' | 'crm'; draft: unknown }> {}
export interface RepWorkflowsDeps {
  loadWork(clientId: string): Promise<RepWorkflowInput>
  brainContext(clientId: string): Promise<string>
  llm: LlmClient
  tokenUsdPerReply: number
  executeApproved(clientId: string, plan: RepWorkflowPlan): Promise<DispatchReceipt>
}
export function buildRepWorkflowsPipeline(source: ClientDeps<RepWorkflowsDeps>): PipelineDefinition {
  return {
    id: 'rep-workflows@0.1.0', moduleId: 'sales.rep-workflows', steps: [
      { id: 'load', run: async (ctx) => (await resolveClientDeps(source, ctx.clientId)).loadWork(ctx.clientId) },
      { id: 'draft', run: async (ctx) => {
        const deps = await resolveClientDeps(source, ctx.clientId); const input = ctx.outputs.load as RepWorkflowInput
        if (!Number.isFinite(deps.tokenUsdPerReply) || deps.tokenUsdPerReply < 0) throw new Error('tokenUsdPerReply must be finite and nonnegative')
        if (input.replies.length) ctx.spendTokensUsd(input.replies.length * deps.tokenUsdPerReply, `drafted ${input.replies.length} reply responses`)
        const brainContext = await deps.brainContext(ctx.clientId)
        const replyDrafts = await Promise.all(input.replies.map(async (reply) => ({ id: reply.id, kind: 'reply' as const, draft: await replyHandler.draftReply({ sender: reply.sender, message: reply.message, brainContext }, deps.llm) })))
        const crmDrafts = input.crmActions.map((action) => ({ id: action.id, kind: 'crm' as const, draft: action }))
        return requirePlan({ summary: `${replyDrafts.length} replies and ${crmDrafts.length} CRM actions`, items: [...replyDrafts, ...crmDrafts] }, 'rep workflow plan')
      } },
      { id: 'review', run: async (ctx) => {
        const plan = ctx.outputs.draft as RepWorkflowPlan
        const replies = plan.items.filter((item) => item.kind === 'reply')
        const crmActions = plan.items.filter((item) => item.kind === 'crm')
        if (replies.length) await ctx.gate('outbound_send', { ...plan, items: replies })
        if (crmActions.length) await ctx.gate('crm_write', { ...plan, items: crmActions })
        return plan
      } },
      { id: 'execute', effect: true, run: async (ctx) => (await resolveClientDeps(source, ctx.clientId)).executeApproved(ctx.clientId, ctx.outputs.draft as RepWorkflowPlan) },
    ],
  }
}

// marketing ----------------------------------------------------------------
export interface EventAttendee { id: string; email: string; event: string; attended: boolean; segment: string }
export interface EventFollowup { attendeeId: string; email: string; event: string; play: string; draft: string }
export interface EventsDeps { loadAttendees(clientId: string): Promise<EventAttendee[]>; draftFollowup(clientId: string, attendee: EventAttendee): EventFollowup | null; send(clientId: string, drafts: EventFollowup[]): Promise<DispatchReceipt> }
export function buildEventsPipeline(source: ClientDeps<EventsDeps>): PipelineDefinition {
  return reviewedPipeline('event-followup@0.1.0', 'marketing.events', 'outbound_send', {
    load: async (clientId) => (await resolveClientDeps(source, clientId)).loadAttendees(clientId),
    prepare: async (clientId, attendees) => { const deps = await resolveClientDeps(source, clientId); const items = attendees.map((a) => deps.draftFollowup(clientId, a)).filter((x): x is EventFollowup => x !== null); return { summary: `${items.length} event follow-up drafts`, items } },
    execute: async (clientId, plan) => (await resolveClientDeps(source, clientId)).send(clientId, plan.items),
  }, 'event follow-up plan')
}

export interface CopyFactoryInput { rows: campaignFactory.CampaignRow[] }
export interface CopyFactoryDeps { loadBrief(clientId: string): Promise<CopyFactoryInput>; templates: campaignFactory.CampaignTemplates; publishDrafts(clientId: string, campaign: campaignFactory.CampaignResult): Promise<DispatchReceipt> }
export function buildCopyFactoryPipeline(source: ClientDeps<CopyFactoryDeps>): PipelineDefinition {
  return {
    id: 'copy-factory@0.1.0', moduleId: 'marketing.copy-factory', steps: [
      { id: 'load', run: async (ctx) => (await resolveClientDeps(source, ctx.clientId)).loadBrief(ctx.clientId) },
      { id: 'generate', run: async (ctx) => { const deps = await resolveClientDeps(source, ctx.clientId); return campaignFactory.generateCampaign((ctx.outputs.load as CopyFactoryInput).rows, deps.templates) } },
      { id: 'review', run: async (ctx) => { const campaign = ctx.outputs.generate as campaignFactory.CampaignResult; await ctx.gate('internal_report', campaign); return campaign } },
      { id: 'publish', effect: true, run: async (ctx) => (await resolveClientDeps(source, ctx.clientId)).publishDrafts(ctx.clientId, ctx.outputs.generate as campaignFactory.CampaignResult) },
    ],
  }
}

export interface AudienceMutation { audience: string; add: string[]; remove: string[]; reason: string }
export interface AdsSyncDeps { loadMutations(clientId: string): Promise<AudienceMutation[]>; sync(clientId: string, mutations: AudienceMutation[]): Promise<DispatchReceipt> }
export function buildAdsSyncPipeline(source: ClientDeps<AdsSyncDeps>): PipelineDefinition {
  return reviewedPipeline('ads-audience-sync@0.1.0', 'marketing.ads-sync', 'outbound_send', {
    load: async (clientId) => (await resolveClientDeps(source, clientId)).loadMutations(clientId),
    prepare: async (_clientId, items) => ({ summary: `${items.length} audience mutations`, items }),
    execute: async (clientId, plan) => (await resolveClientDeps(source, clientId)).sync(clientId, plan.items),
  }, 'ads sync plan')
}

// revops -------------------------------------------------------------------
export interface RoutingInput { records: router.RoutingInput[] }
export interface RoutingDeps { loadRecords(clientId: string): Promise<RoutingInput>; rules: router.RoutingRules; writeAssignments(clientId: string, assignments: router.RoutingDecision[]): Promise<DispatchReceipt> }
export function buildRoutingPipeline(source: ClientDeps<RoutingDeps>): PipelineDefinition {
  return {
    id: 'revops-routing@0.1.0', moduleId: 'revops.routing', steps: [
      { id: 'load', run: async (ctx) => (await resolveClientDeps(source, ctx.clientId)).loadRecords(ctx.clientId) },
      { id: 'route', run: async (ctx) => { const deps = await resolveClientDeps(source, ctx.clientId); const decisions = (ctx.outputs.load as RoutingInput).records.map((record) => router.route(record, deps.rules)); return requirePlan({ summary: `${decisions.filter((d) => d.decision === 'assigned').length} assignments; ${decisions.filter((d) => d.decision === 'manual_review').length} manual reviews`, items: decisions }, 'routing plan') } },
      { id: 'review', run: async (ctx) => { const plan = ctx.outputs.route as ReviewPlan<router.RoutingDecision>; await ctx.gate('crm_write', plan); return plan } },
      { id: 'write', effect: true, run: async (ctx) => (await resolveClientDeps(source, ctx.clientId)).writeAssignments(ctx.clientId, (ctx.outputs.route as ReviewPlan<router.RoutingDecision>).items.filter((d) => d.decision === 'assigned')) },
    ],
  }
}

export interface TamAccount { id: string; name: string; fields: Record<string, string | number | boolean | null> }
export interface TamScore { accountId: string; score: number; tier: string; reasons: string[]; plays: string[] }
export interface TamDeps { loadAccounts(clientId: string): Promise<TamAccount[]>; score(clientId: string, account: TamAccount): TamScore; writeScores(clientId: string, scores: TamScore[]): Promise<DispatchReceipt> }
export function buildTamPipeline(source: ClientDeps<TamDeps>): PipelineDefinition {
  return reviewedPipeline('tam-mapping@0.1.0', 'revops.tam', 'crm_write', {
    load: async (clientId) => (await resolveClientDeps(source, clientId)).loadAccounts(clientId),
    prepare: async (clientId, accounts) => { const deps = await resolveClientDeps(source, clientId); const items = accounts.map((a) => deps.score(clientId, a)); return { summary: `${items.length} TAM scores`, items } },
    execute: async (clientId, plan) => (await resolveClientDeps(source, clientId)).writeScores(clientId, plan.items),
  }, 'TAM plan')
}

export interface EtlChange { destination: string; object: string; externalId: string; fields: Record<string, unknown> }
export interface EtlDeps { loadChanges(clientId: string): Promise<EtlChange[]>; validate(clientId: string, changes: EtlChange[]): Promise<{ valid: EtlChange[]; rejected: Array<{ change: EtlChange; reason: string }> }>; write(clientId: string, changes: EtlChange[]): Promise<DispatchReceipt> }
export function buildEtlPipeline(source: ClientDeps<EtlDeps>): PipelineDefinition {
  return {
    id: 'reporting-etl@0.1.0', moduleId: 'revops.etl', steps: [
      { id: 'load', run: async (ctx) => (await resolveClientDeps(source, ctx.clientId)).loadChanges(ctx.clientId) },
      { id: 'validate', run: async (ctx) => (await resolveClientDeps(source, ctx.clientId)).validate(ctx.clientId, ctx.outputs.load as EtlChange[]) },
      { id: 'review', run: async (ctx) => { const result = ctx.outputs.validate as Awaited<ReturnType<EtlDeps['validate']>>; await ctx.gate('crm_write', { summary: `${result.valid.length} reverse-ETL writes; ${result.rejected.length} rejected`, ...result }); return result } },
      { id: 'write', effect: true, run: async (ctx) => (await resolveClientDeps(source, ctx.clientId)).write(ctx.clientId, (ctx.outputs.validate as Awaited<ReturnType<EtlDeps['validate']>>).valid) },
    ],
  }
}

// always-on ----------------------------------------------------------------
export interface SignalsInput { signals: signalWatcher.WatchedSignal[] }
export interface SignalsDeps { loadSignals(clientId: string): Promise<SignalsInput>; rules: signalWatcher.SignalRule[]; persistTriggers(clientId: string, matches: signalWatcher.SignalMatch[]): Promise<DispatchReceipt> }
export function buildSignalsPipeline(source: ClientDeps<SignalsDeps>): PipelineDefinition {
  return {
    id: 'signal-watcher@0.1.0', moduleId: 'platform.signals', steps: [
      { id: 'load', run: async (ctx) => (await resolveClientDeps(source, ctx.clientId)).loadSignals(ctx.clientId) },
      { id: 'match', run: async (ctx) => { const deps = await resolveClientDeps(source, ctx.clientId); return signalWatcher.matchSignals((ctx.outputs.load as SignalsInput).signals, deps.rules) } },
      { id: 'review', run: async (ctx) => { const result = ctx.outputs.match as ReturnType<typeof signalWatcher.matchSignals>; if (result.matches.length) await ctx.gate('internal_report', result); return result } },
      { id: 'persist', effect: true, run: async (ctx) => (await resolveClientDeps(source, ctx.clientId)).persistTriggers(ctx.clientId, (ctx.outputs.match as ReturnType<typeof signalWatcher.matchSignals>).matches) },
    ],
  }
}

export interface Digest { title: string; markdown: string; sourceRefs: string[] }
export interface DigestsDeps { loadDigest(clientId: string): Promise<Digest>; deliver(clientId: string, digest: Digest): Promise<DispatchReceipt> }
export function buildDigestsPipeline(source: ClientDeps<DigestsDeps>): PipelineDefinition {
  return {
    id: 'weekly-digests@0.1.0', moduleId: 'platform.digests', steps: [
      { id: 'prepare', run: async (ctx) => (await resolveClientDeps(source, ctx.clientId)).loadDigest(ctx.clientId) },
      { id: 'review', run: async (ctx) => { const digest = ctx.outputs.prepare as Digest; if (!digest.title.trim() || !digest.markdown.trim()) throw new Error('digest title and content are required'); await ctx.gate('client_comms', digest); return digest } },
      { id: 'deliver', effect: true, run: async (ctx) => (await resolveClientDeps(source, ctx.clientId)).deliver(ctx.clientId, ctx.outputs.prepare as Digest) },
    ],
  }
}

export interface MetricsInput extends sowQbrGenerator.EngagementDocumentInput { metrics: Record<string, number | null> }
export interface MetricsDeps { loadMetrics(clientId: string): Promise<MetricsInput>; llm: LlmClient; tokenUsdPerReport: number; publish(clientId: string, report: sowQbrGenerator.EngagementDocumentDraft): Promise<DispatchReceipt> }
export function buildMetricsPipeline(source: ClientDeps<MetricsDeps>): PipelineDefinition {
  return {
    id: 'metrics-reporting@0.1.0', moduleId: 'platform.metrics', steps: [
      { id: 'load', run: async (ctx) => (await resolveClientDeps(source, ctx.clientId)).loadMetrics(ctx.clientId) },
      { id: 'draft', run: async (ctx) => { const deps = await resolveClientDeps(source, ctx.clientId); if (!Number.isFinite(deps.tokenUsdPerReport) || deps.tokenUsdPerReport <= 0) throw new Error('tokenUsdPerReport must be finite and positive'); ctx.spendTokensUsd(deps.tokenUsdPerReport, 'drafted grounded metrics/QBR report'); return sowQbrGenerator.draftEngagementDocument(ctx.outputs.load as MetricsInput, deps.llm) } },
      { id: 'review', run: async (ctx) => { const report = ctx.outputs.draft as sowQbrGenerator.EngagementDocumentDraft; await ctx.gate('client_comms', report); return report } },
      { id: 'publish', effect: true, run: async (ctx) => (await resolveClientDeps(source, ctx.clientId)).publish(ctx.clientId, ctx.outputs.draft as sowQbrGenerator.EngagementDocumentDraft) },
    ],
  }
}
