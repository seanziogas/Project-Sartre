import type { GateRecord, PipelineDefinition } from '@sartre/pipelines'
import {
  campaignFactory,
  gtmStrategist,
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

function requireUnitCost(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be finite and nonnegative`)
  return value
}

/**
 * Per-item LLM drafting must be fault-tolerant: one malformed model response
 * (schema violation, grounding-guard rejection, non-JSON) drops that single
 * item, never the whole batch — otherwise one flaky row strands an entire
 * tenant run with no reviewable output. Returns the successful mappings plus
 * the count that failed so the review summary can surface it.
 */
async function draftPerItem<TIn, TOut>(
  items: TIn[],
  map: (item: TIn) => Promise<TOut>,
): Promise<{ items: TOut[]; failed: number }> {
  const settled = await Promise.allSettled(items.map(map))
  const results: TOut[] = []
  let failed = 0
  for (const outcome of settled) {
    if (outcome.status === 'fulfilled') results.push(outcome.value)
    else failed++
  }
  return { items: results, failed }
}

function failedSuffix(failed: number): string {
  return failed ? `; ${failed} dropped on model/grounding errors` : ''
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
  brainContext(clientId: string): Promise<string>
  llm: LlmClient
  tokenUsdPerPlan: number
  activate(clientId: string, plays: AccountPlay[]): Promise<DispatchReceipt>
}
export function buildAbmPipeline(source: ClientDeps<AbmDeps>): PipelineDefinition {
  return {
    id: 'abm@0.1.0', moduleId: 'sales.abm', steps: [
      { id: 'load', run: async (ctx) => (await resolveClientDeps(source, ctx.clientId)).loadAccounts(ctx.clientId) },
      { id: 'plan', run: async (ctx) => {
        const deps = await resolveClientDeps(source, ctx.clientId)
        const accounts = (ctx.outputs.load as AbmInput).accounts
        requireUnitCost(deps.tokenUsdPerPlan, 'tokenUsdPerPlan')
        if (accounts.length) ctx.spendTokensUsd(accounts.length * deps.tokenUsdPerPlan, `planned ${accounts.length} ABM accounts`)
        const brainContext = await deps.brainContext(ctx.clientId)
        const { items: planned, failed } = await draftPerItem(accounts, async (account) => ({
          account, plan: await gtmStrategist.planAbmAccount({ account, brainContext }, deps.llm),
        }))
        const kept = planned.filter(({ plan }) => !plan.skip)
        const items = kept.map(({ account, plan }) => ({ accountId: account.id, accountName: account.name, play: plan.play, rationale: plan.rationale, contacts: plan.contacts }))
        return requirePlan({ summary: `${items.length} account plays; ${planned.length - kept.length} skipped as ICP misfits${failedSuffix(failed)}`, items }, 'ABM plan')
      } },
      { id: 'review', run: async (ctx) => { const plan = ctx.outputs.plan as ReviewPlan<AccountPlay>; await ctx.gate('outbound_send', plan); return plan } },
      { id: 'activate', effect: true, run: async (ctx) => (await resolveClientDeps(source, ctx.clientId)).activate(ctx.clientId, (ctx.outputs.plan as ReviewPlan<AccountPlay>).items) },
    ],
  }
}

export interface TakeoutCandidate { accountId: string; accountName: string; competitor: string; evidence: string[] }
export interface TakeoutPlay extends TakeoutCandidate { angle: string; proof: string; draft: string }
export interface TakeoutDeps {
  loadCandidates(clientId: string): Promise<TakeoutCandidate[]>
  brainContext(clientId: string): Promise<string>
  llm: LlmClient
  tokenUsdPerPlay: number
  activate(clientId: string, plays: TakeoutPlay[]): Promise<DispatchReceipt>
}
export function buildTakeoutPipeline(source: ClientDeps<TakeoutDeps>): PipelineDefinition {
  return {
    id: 'competitive-takeout@0.1.0', moduleId: 'sales.takeout', steps: [
      { id: 'load', run: async (ctx) => (await resolveClientDeps(source, ctx.clientId)).loadCandidates(ctx.clientId) },
      { id: 'prepare', run: async (ctx) => {
        const deps = await resolveClientDeps(source, ctx.clientId)
        const candidates = ctx.outputs.load as TakeoutCandidate[]
        // Evidence-free candidates never reach the model — no evidence means no grounded angle.
        const grounded = candidates.filter((candidate) => candidate.evidence.length > 0)
        requireUnitCost(deps.tokenUsdPerPlay, 'tokenUsdPerPlay')
        if (grounded.length) ctx.spendTokensUsd(grounded.length * deps.tokenUsdPerPlay, `drafted ${grounded.length} takeout plays`)
        const brainContext = await deps.brainContext(ctx.clientId)
        const { items, failed } = await draftPerItem(grounded, async (candidate) => {
          const draft = await gtmStrategist.prepareTakeoutPlay({ candidate, brainContext }, deps.llm)
          return { ...candidate, angle: draft.angle, proof: draft.proof, draft: draft.draft }
        })
        return requirePlan({ summary: `${items.length} competitive takeout plays; ${candidates.length - grounded.length} skipped without evidence${failedSuffix(failed)}`, items }, 'takeout plan')
      } },
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
export interface EventsDeps {
  loadAttendees(clientId: string): Promise<EventAttendee[]>
  brainContext(clientId: string): Promise<string>
  llm: LlmClient
  tokenUsdPerDraft: number
  send(clientId: string, drafts: EventFollowup[]): Promise<DispatchReceipt>
}
export function buildEventsPipeline(source: ClientDeps<EventsDeps>): PipelineDefinition {
  return {
    id: 'event-followup@0.1.0', moduleId: 'marketing.events', steps: [
      { id: 'load', run: async (ctx) => (await resolveClientDeps(source, ctx.clientId)).loadAttendees(ctx.clientId) },
      { id: 'prepare', run: async (ctx) => {
        const deps = await resolveClientDeps(source, ctx.clientId)
        const attendees = (ctx.outputs.load as EventAttendee[]).filter((attendee) => attendee.email.trim())
        requireUnitCost(deps.tokenUsdPerDraft, 'tokenUsdPerDraft')
        if (attendees.length) ctx.spendTokensUsd(attendees.length * deps.tokenUsdPerDraft, `drafted ${attendees.length} event follow-ups`)
        const brainContext = await deps.brainContext(ctx.clientId)
        const { items, failed } = await draftPerItem(attendees, async (attendee) => {
          // Play selection is deterministic; the model only writes the copy.
          const play = attendee.attended ? 'attendee' : 'no-show'
          const draft = await gtmStrategist.draftEventFollowup({ attendee, play, brainContext }, deps.llm)
          return { attendeeId: attendee.id, email: attendee.email, event: attendee.event, play, draft: draft.draft }
        })
        return requirePlan({ summary: `${items.length} event follow-up drafts${failedSuffix(failed)}`, items }, 'event follow-up plan')
      } },
      { id: 'review', run: async (ctx) => { const plan = ctx.outputs.prepare as ReviewPlan<EventFollowup>; await ctx.gate('outbound_send', plan); return plan } },
      { id: 'execute', effect: true, run: async (ctx) => (await resolveClientDeps(source, ctx.clientId)).send(ctx.clientId, (ctx.outputs.prepare as ReviewPlan<EventFollowup>).items) },
    ],
  }
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
export interface TamDeps {
  loadAccounts(clientId: string): Promise<TamAccount[]>
  brainContext(clientId: string): Promise<string>
  llm: LlmClient
  tokenUsdPerScore: number
  writeScores(clientId: string, scores: TamScore[]): Promise<DispatchReceipt>
}
export function buildTamPipeline(source: ClientDeps<TamDeps>): PipelineDefinition {
  return {
    id: 'tam-mapping@0.1.0', moduleId: 'revops.tam', steps: [
      { id: 'load', run: async (ctx) => (await resolveClientDeps(source, ctx.clientId)).loadAccounts(ctx.clientId) },
      { id: 'prepare', run: async (ctx) => {
        const deps = await resolveClientDeps(source, ctx.clientId)
        const accounts = ctx.outputs.load as TamAccount[]
        requireUnitCost(deps.tokenUsdPerScore, 'tokenUsdPerScore')
        if (accounts.length) ctx.spendTokensUsd(accounts.length * deps.tokenUsdPerScore, `scored ${accounts.length} TAM accounts`)
        const brainContext = await deps.brainContext(ctx.clientId)
        const { items, failed } = await draftPerItem(accounts, async (account) => {
          const assessment = await gtmStrategist.scoreTamAccount({ account, brainContext }, deps.llm)
          return { accountId: account.id, score: assessment.score, tier: assessment.tier, reasons: assessment.reasons, plays: assessment.plays }
        })
        return requirePlan({ summary: `${items.length} TAM scores${failedSuffix(failed)}`, items }, 'TAM plan')
      } },
      { id: 'review', run: async (ctx) => { const plan = ctx.outputs.prepare as ReviewPlan<TamScore>; await ctx.gate('crm_write', plan); return plan } },
      { id: 'execute', effect: true, run: async (ctx) => (await resolveClientDeps(source, ctx.clientId)).writeScores(ctx.clientId, (ctx.outputs.prepare as ReviewPlan<TamScore>).items) },
    ],
  }
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
