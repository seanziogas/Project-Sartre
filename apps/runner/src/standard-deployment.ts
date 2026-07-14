import { z } from 'zod'
import type {
  AudienceSyncClient, CachedField, CrmReader, CrmWriter, InboundReader, IntentReader, LeadConverter,
  NamespacedWrite, SequenceLead, SequencerClient, StagedBatch, WarehouseClient,
} from '@sartre/connectors'
import { EnrichmentCache, IntentEvent } from '@sartre/connectors'
import type { Account, Contact, MvdStatus, Signal } from '@sartre/core'
import { CanonicalIngestionCoordinator } from '@sartre/data'
import type { DataHealthReport, LeadCandidate, SourceMapping } from '@sartre/data'
import {
  PostgresCacheStore, PostgresCanonicalStore, PostgresFeedbackLog, PostgresRuntimeArtifactStore,
  PostgresStagingStore,
} from '@sartre/db'
import type {
  AbmInput, AccountPlay, AudienceMutation, CopyFactoryInput, Digest, DispatchReceipt, EtlChange,
  EventAttendee, EventFollowup, LearningDraft, MetricsInput, OptimizationInput, OutboundInput,
  RepWorkflowInput, RepWorkflowPlan, RoutingInput, TamAccount, TamScore, TakeoutCandidate,
  TakeoutPlay,
} from '@sartre/modules'
import { campaignFactory, router, signalWatcher } from '@sartre/skills'
import type { SequenceEnrollmentReceipt } from '@sartre/connectors'
import type { RunnerDeploymentContext } from './deployment.js'
import type { RunnerModuleDeps } from './registry.js'

interface StandardRuntimeConfig {
  connections: Record<string, string>
  destinations: Record<string, string>
  costs: Record<string, number>
  modules: Record<string, unknown>
}
const StandardRuntimeConfig: z.ZodType<StandardRuntimeConfig> = z.object({
  connections: z.record(z.string(), z.string()),
  destinations: z.record(z.string(), z.string()),
  costs: z.record(z.string(), z.number().finite().nonnegative()),
  modules: z.record(z.string(), z.unknown()),
})

/**
 * First-party deployment bundle. Inputs that are engagement-specific enter as
 * tenant-scoped runtime artifacts; policy/configuration enters only through an
 * active, human-approved brain/config/standard-runtime.yaml envelope.
 */
export function createStandardModuleDeps(context: RunnerDeploymentContext): RunnerModuleDeps {
  const artifacts = new PostgresRuntimeArtifactStore(context.db)
  const canonical = new PostgresCanonicalStore(context.db)
  const feedback = new PostgresFeedbackLog(context.db)
  const staging = new PostgresStagingStore(context.db)
  const cache = new EnrichmentCache(new PostgresCacheStore(context.db))

  const config = (clientId: string) => context.brains.loadApprovedConfig(clientId, 'standard-runtime.yaml', StandardRuntimeConfig)
  const input = async <T>(clientId: string, moduleId: string): Promise<T> => {
    const value = await artifacts.get<T>(clientId, `standard-input:${moduleId}`)
    if (value === null) throw new Error(`${moduleId} requires tenant runtime artifact standard-input:${moduleId}`)
    return value
  }
  const publish = async (clientId: string, moduleId: string, value: unknown): Promise<DispatchReceipt> => {
    await artifacts.put(clientId, `standard-output:${moduleId}`, value)
    return { affected: Array.isArray(value) ? value.length : 1, detail: `stored reviewed ${moduleId} output` }
  }
  const moduleConfig = <T>(runtime: StandardRuntimeConfig, moduleId: string): T => {
    const value = runtime.modules[moduleId]
    if (!value || typeof value !== 'object') throw new Error(`${moduleId} requires approved standard-runtime module config`)
    return value as T
  }
  const connection = (runtime: StandardRuntimeConfig, name: string): string => {
    const value = runtime.connections[name]
    if (!value) throw new Error(`standard-runtime connection ${name} is required`)
    return value
  }
  const destination = (runtime: StandardRuntimeConfig, name: string): string => {
    const value = runtime.destinations[name]
    if (!value) throw new Error(`standard-runtime destination ${name} is required`)
    return value
  }
  const cost = (runtime: StandardRuntimeConfig, name: string, fallback: number): number => runtime.costs[name] ?? fallback

  const crm = async (clientId: string): Promise<CrmReader & CrmWriter> => {
    const runtime = await config(clientId)
    const provider = connection(runtime, 'crm')
    if (provider !== 'salesforce' && provider !== 'hubspot' && provider !== 'attio') throw new Error('standard CRM writes require salesforce, hubspot, or attio')
    const settings = moduleConfig<{ namespacePrefix: string }>(runtime, 'crm')
    return context.tools.crm(clientId, provider, settings.namespacePrefix)
  }
  const sequencer = async (clientId: string): Promise<SequencerClient> => {
    const provider = connection(await config(clientId), 'sequencer')
    if (!['smartlead', 'instantly', 'outreach', 'salesloft', 'apollo', 'heyreach', 'lemlist', 'mailshake'].includes(provider)) throw new Error(`unsupported standard sequencer ${provider}`)
    return context.tools.sequencer(clientId, provider as Parameters<typeof context.tools.sequencer>[1])
  }
  const leadConverter = async (clientId: string): Promise<LeadConverter> => {
    const runtime = await config(clientId)
    if (connection(runtime, 'crm') !== 'salesforce') throw new Error('revops.lead-convert requires a Salesforce CRM connection')
    return await crm(clientId) as CrmReader & CrmWriter & LeadConverter
  }
  const enroll = async (clientId: string, campaignId: string, ids: string[]): Promise<DispatchReceipt> => {
    const leads = await input<Record<string, SequenceLead>>(clientId, 'sequence-leads')
    const selected = ids.map((id) => leads[id]).filter((lead): lead is SequenceLead => lead !== undefined)
    if (selected.length !== ids.length) throw new Error(`sequence-leads artifact is missing ${ids.length - selected.length} reviewed row(s)`)
    const receipt: SequenceEnrollmentReceipt = await (await sequencer(clientId)).enroll(campaignId, selected)
    return { affected: receipt.enrolled, detail: `${receipt.provider}:${receipt.campaignId}; skipped=${receipt.skipped}` }
  }
  const notify = async (clientId: string, subject: string, body: string): Promise<void> => {
    const runtime = await config(clientId)
    const provider = connection(runtime, 'comms')
    if (provider === 'slack' || provider === 'teams') {
      await (await context.tools.comms(clientId, provider)).sendMessage(destination(runtime, 'comms'), `*${subject}*\n${body}`)
      return
    }
    if (provider === 'gmail' || provider === 'microsoft-email') {
      await (await context.tools.email(clientId, provider)).sendEmail({ to: destination(runtime, 'email').split(',').map((item) => item.trim()), subject, text: body })
      return
    }
    throw new Error(`unsupported standard communications provider ${provider}`)
  }
  const namespacedWrites = async (clientId: string, writes: NamespacedWrite[]): Promise<DispatchReceipt> => {
    if (!writes.length) return { affected: 0 }
    const writer = await crm(clientId)
    const snapshot = await writer.snapshot(writes)
    const receipt = await writer.writeNamespaced(writes, snapshot)
    return { affected: receipt.written, detail: `snapshot=${receipt.snapshotRef}; rejected=${receipt.rejected.length}` }
  }
  const sendEventFollowups = async (clientId: string, drafts: EventFollowup[]): Promise<DispatchReceipt> => {
    const provider = connection(await config(clientId), 'email')
    if (provider !== 'gmail' && provider !== 'microsoft-email') throw new Error(`unsupported standard email provider ${provider}`)
    const sender = await context.tools.email(clientId, provider)
    for (const draft of drafts) {
      await sender.sendEmail({ to: [draft.email], subject: `Following up on ${draft.event}`, text: draft.draft })
    }
    return { affected: drafts.length, detail: `${provider} event follow-up delivery` }
  }

  return {
    enrichment: async (clientId) => {
      const runtime = await config(clientId)
      const cfg = moduleConfig<{ accountMapping: SourceMapping; contactMapping: SourceMapping; opportunityMapping?: SourceMapping; activityMapping?: SourceMapping }>(runtime, 'revops.enrichment')
      const reader = await crm(clientId)
      return {
        refreshCanonical: async () => {
          const [accountBatch, contactBatch, opportunityBatch, activityBatch] = await Promise.all([
            collect(reader, 'pullAccounts'), collect(reader, 'pullContacts'), collect(reader, 'pullOpportunities'), collect(reader, 'pullActivities'),
          ])
          const result = await new CanonicalIngestionCoordinator(staging, canonical).refresh(clientId, {
            accountBatch, contactBatch, accountMapping: cfg.accountMapping, contactMapping: cfg.contactMapping,
            ...(cfg.opportunityMapping ? { opportunityBatch, opportunityMapping: cfg.opportunityMapping } : {}),
            ...(cfg.activityMapping ? { activityBatch, activityMapping: cfg.activityMapping } : {}),
          })
          return result.audit
        },
        loadPreviousReport: (id) => artifacts.get<DataHealthReport>(id, 'health-report'),
        saveReport: (id, report) => artifacts.put(id, 'health-report', report),
        saveMvd: (id, mvd) => artifacts.put(id, 'mvd', mvd),
        notify,
      }
    },
    reactivation: async (clientId) => {
      const runtime = await config(clientId)
      const cfg = moduleConfig<{ vocabularies: Record<string, string[]>; reviewerRules: string[]; minScore: number; defaultPlay: string; defaultGroup: string; campaignId: string; templates: campaignFactory.CampaignTemplates }>(runtime, 'sales.reactivation')
      const brainContext = await context.brains.loadContext(clientId, ['icp.md', 'grading.md', 'use-cases.md'])
      return {
        loadCanonicalClosedLost: (id) => canonical.closedLostRows(id),
        graderConfig: { brainContext, vocabularies: cfg.vocabularies, reviewerRules: cfg.reviewerRules },
        tokenUsdPerRow: cost(runtime, 'graderRowUsd', 0.01), minScore: cfg.minScore,
        playFor: (grade) => ({ play: cfg.defaultPlay, group: cfg.defaultGroup, slots: { grade_reasoning: grade.reasoning } }),
        templates: cfg.templates,
        enroll: async (rows) => (await enroll(clientId, cfg.campaignId, rows.map((row) => row.id))).affected,
      }
    },
    inbound: async (clientId) => {
      const runtime = await config(clientId)
      const cfg = moduleConfig<{ provider: 'qualified' | 'linkedin-leadgen' | 'typeform' | 'chilipiper' | 'marketo'; idField: string; domainField: string; nameField: string; fieldsWanted: string[]; clayCreditsPerCall: number; routingRules: router.RoutingRules; ownerField: string; reasoningField: string }>(runtime, 'marketing.inbound')
      const source: InboundReader = cfg.provider === 'marketo' ? await context.tools.marketingAutomation(clientId) : await context.tools.inbound(clientId, cfg.provider)
      const enrichment = await context.tools.enrichment(clientId)
      return {
        pullNewLeads: async () => (await source.pullLeads()).rows.map((row) => ({ id: String(row[cfg.idField] ?? ''), domain: String(row[cfg.domainField] ?? '') || null, name: String(row[cfg.nameField] ?? '') || null, raw: scalarRecord(row) })),
        enrichment: { cache, provider: async (domain) => Object.fromEntries(Object.entries(await enrichment.enrich(domain, cfg.fieldsWanted)).map(([field, value]) => [field, { value, provenance: { source: 'enrichment', origin: 'clay', retrievedAt: new Date().toISOString(), confidence: 'medium' } } satisfies CachedField])) }, fieldsWanted: cfg.fieldsWanted,
        clayCreditsPerProviderCall: cfg.clayCreditsPerCall, routingRules: cfg.routingRules,
        toRoutingFields: (lead, enriched) => ({ ...lead.raw, ...Object.fromEntries(Object.entries(enriched.values).map(([field, value]) => [field, value?.value ?? null])) }),
        writeAssignments: async (assignments) => (await namespacedWrites(clientId, assignments.map((item) => ({ object: 'contact', externalId: item.id, fields: { [cfg.ownerField]: item.owner, [cfg.reasoningField]: item.reasoning } })))).affected,
      }
    },
    remediation: async (clientId) => ({
      loadHealthReport: async (id) => required(await artifacts.get<DataHealthReport>(id, 'health-report'), 'health-report'),
      prepareWrites: async (id) => ({ writes: await input<NamespacedWrite[]>(id, 'revops.remediation') }), crm: await crm(clientId),
    }),
    copilotBriefs: async (clientId) => ({
      loadBriefInputs: async (id) => {
        const brainContext = await context.brains.loadContext(id, ['company.md', 'icp.md', 'voice.md', 'use-cases.md'])
        return (await canonical.briefContexts(id)).filter((item) => item.evidence.length).map((item) => ({ ...item, generatedAt: new Date().toISOString(), brainContext }))
      },
      tokenUsdPerBrief: cost(await config(clientId), 'copilotBriefUsd', 0.05),
      publishBriefs: async (id, briefs) => (await publish(id, 'sales.copilot-briefs', briefs)).affected,
    }),
    dedup: async (clientId) => {
      const cfg = moduleConfig<{ flagField: string }>(await config(clientId), 'revops.dedup')
      return { loadDuplicateGroups: (id) => canonical.duplicateReviewGroups(id), prepareAnnotationWrites: async (_id, groups) => groups.flatMap((group) => group.members.flatMap((member) => Object.values(member.externalIds).map((externalId) => ({ object: group.recordType, externalId, fields: { [cfg.flagField]: group.id } })))), crm: await crm(clientId) }
    },
    leadConvert: async (clientId) => ({
      sourceSystem: 'salesforce',
      loadConversionInput: async (id) => ({ leads: await input<LeadCandidate[]>(id, 'revops.lead-convert'), accounts: await canonical.listAll(id, 'account') as Account[], contacts: await canonical.listAll(id, 'contact') as Contact[] }),
      converter: await leadConverter(clientId),
    }),
    deanon: async (clientId) => {
      const runtime = await config(clientId)
      const cfg = moduleConfig<{ provider: 'sixsense' | 'g2' | 'clearbit' | 'koala' | 'bombora'; idField: string; domainField: string; kindField: string; occurredAtField: string; detailField: string }>(runtime, 'marketing.deanon')
      const source: IntentReader = await context.tools.intent(clientId, cfg.provider)
      return { sourceSystem: cfg.provider, loadDeanonInput: async (id) => ({ events: (await source.pullSignals()).rows.map((row) => IntentEvent.parse({ clientId: id, sourceSystem: cfg.provider, externalId: String(row[cfg.idField] ?? ''), companyDomain: row[cfg.domainField] ?? null, companyName: null, kind: String(row[cfg.kindField] ?? 'intent'), occurredAt: String(row[cfg.occurredAtField] ?? new Date().toISOString()), detail: String(row[cfg.detailField] ?? '') })), accounts: await canonical.listAll(id, 'account') as Account[] }), persistSignals: async (id, signals) => (await canonical.putSignals(id, signals)).length }
    },
    learning: async (clientId) => ({
      loadFeedback: (id) => feedback.list(id), evaluateProposal: async () => ({ pass: false, detail: 'standard adapter fails closed until a deployment known-answer evaluator is configured' }),
      loadOptimizationInput: (id) => input<OptimizationInput>(id, 'platform.learning'), evaluateOptimizationDraft: async () => ({ pass: false, detail: 'standard adapter fails closed until a deployment optimization evaluator is configured' }),
      persistDrafts: async (id, drafts) => (await publish(id, 'platform.learning', drafts)).affected,
    }),
    quality: async () => ({ loadReports: async (id) => ({ current: required(await artifacts.get<DataHealthReport>(id, 'health-report'), 'health-report'), previous: await artifacts.get<DataHealthReport>(id, 'previous-health-report') }), saveMvd: (id, mvd) => artifacts.put(id, 'mvd', mvd), notify }),
    outbound: async (clientId) => {
      const cfg = moduleConfig<{ templates: campaignFactory.CampaignTemplates; campaignId: string }>(await config(clientId), 'sales.outbound')
      return { loadCandidates: (id) => input<OutboundInput>(id, 'sales.outbound'), templates: cfg.templates, enroll: async (id, rows) => enroll(id, cfg.campaignId, rows.map((row) => row.id)) }
    },
    abm: async () => ({ loadAccounts: (id) => input<AbmInput>(id, 'sales.abm'), planAccount: (_id, account) => ({ accountId: account.id, accountName: account.name, play: String(account.fields.play ?? 'account-review'), rationale: String(account.fields.rationale ?? 'approved account selection'), contacts: Array.isArray(account.fields.contacts) ? account.fields.contacts.map(String) : [] }), activate: (id, plays) => publish(id, 'sales.abm', plays) }),
    takeout: async () => ({ loadCandidates: (id) => input<TakeoutCandidate[]>(id, 'sales.takeout'), preparePlay: (_id, candidate) => ({ ...candidate, angle: candidate.evidence[0] ?? 'competitive displacement', proof: candidate.evidence.join('; '), draft: `Competitive takeout: ${candidate.competitor}` }), activate: (id, plays) => publish(id, 'sales.takeout', plays) }),
    repWorkflows: async (clientId) => ({ loadWork: (id) => input<RepWorkflowInput>(id, 'sales.rep-workflows'), brainContext: (id) => context.brains.loadContext(id, ['company.md', 'voice.md', 'use-cases.md']), tokenUsdPerReply: cost(await config(clientId), 'replyUsd', 0.02), executeApproved: (id, plan) => publish(id, 'sales.rep-workflows', plan) }),
    events: async () => ({ loadAttendees: (id) => input<EventAttendee[]>(id, 'marketing.events'), draftFollowup: (_id, attendee) => attendee.email ? { attendeeId: attendee.id, email: attendee.email, event: attendee.event, play: attendee.attended ? 'attendee' : 'no-show', draft: `Follow up regarding ${attendee.event}` } : null, send: sendEventFollowups }),
    copyFactory: async (clientId) => { const cfg = moduleConfig<{ templates: campaignFactory.CampaignTemplates }>(await config(clientId), 'marketing.copy-factory'); return { loadBrief: (id) => input<CopyFactoryInput>(id, 'marketing.copy-factory'), templates: cfg.templates, publishDrafts: (id, campaign) => publish(id, 'marketing.copy-factory', campaign) } },
    adsSync: async (clientId) => { const runtime = await config(clientId); const provider = connection(runtime, 'audience'); if (!['linkedin-ads', 'google-ads', 'meta-ads'].includes(provider)) throw new Error(`unsupported standard audience provider ${provider}`); const audience = await context.tools.audience(clientId, provider as Parameters<typeof context.tools.audience>[1]); return { loadMutations: (id) => input<AudienceMutation[]>(id, 'marketing.ads-sync'), sync: async (_id, mutations) => combineReceipts(await Promise.all(mutations.map((mutation) => audience.syncEmails(mutation.audience, mutation.add, mutation.remove)))) } },
    routing: async (clientId) => { const cfg = moduleConfig<{ rules: router.RoutingRules; ownerField: string; reasoningField: string }>(await config(clientId), 'revops.routing'); return { loadRecords: (id) => input<RoutingInput>(id, 'revops.routing'), rules: cfg.rules, writeAssignments: (id, decisions) => namespacedWrites(id, decisions.map((decision) => ({ object: 'contact', externalId: decision.id, fields: { [cfg.ownerField]: decision.owner, [cfg.reasoningField]: decision.reasoning } }))) } },
    tam: async (clientId) => { const cfg = moduleConfig<{ scoreField: string; tierField: string; defaultScore: number; defaultTier: string }>(await config(clientId), 'revops.tam'); return { loadAccounts: (id) => input<TamAccount[]>(id, 'revops.tam'), score: (_id, account) => ({ accountId: account.id, score: Number(account.fields.score ?? cfg.defaultScore), tier: String(account.fields.tier ?? cfg.defaultTier), reasons: ['approved standard-runtime scoring inputs'], plays: [] }), writeScores: (id, scores) => namespacedWrites(id, scores.map((score) => ({ object: 'account', externalId: score.accountId, fields: { [cfg.scoreField]: score.score, [cfg.tierField]: score.tier } }))) } },
    etl: async (clientId) => { const runtime = await config(clientId); const provider = connection(runtime, 'warehouse'); if (!['snowflake', 'bigquery', 'databricks', 'redshift'].includes(provider)) throw new Error(`unsupported standard warehouse ${provider}`); const warehouse: WarehouseClient = await context.tools.warehouse(clientId, provider as Parameters<typeof context.tools.warehouse>[1]); return { loadChanges: (id) => input<EtlChange[]>(id, 'revops.etl'), validate: async (_id, changes) => ({ valid: changes.filter((change) => typeof change.fields.sql === 'string'), rejected: changes.filter((change) => typeof change.fields.sql !== 'string').map((change) => ({ change, reason: 'fields.sql is required' })) }), write: async (_id, changes) => combineReceipts(await Promise.all(changes.map(async (change) => warehouse.execute(String(change.fields.sql), scalarRecord(change.fields.bindings && typeof change.fields.bindings === 'object' ? change.fields.bindings as Record<string, unknown> : {})))) ) } },
    signals: async (clientId) => { const cfg = moduleConfig<{ rules: signalWatcher.SignalRule[] }>(await config(clientId), 'platform.signals'); return { loadSignals: (id) => input(id, 'platform.signals'), rules: cfg.rules, persistTriggers: (id, matches) => publish(id, 'platform.signals', matches) } },
    digests: async () => ({ loadDigest: (id) => input<Digest>(id, 'platform.digests'), deliver: async (id, digest) => { await notify(id, digest.title, digest.markdown); return { affected: 1 } } }),
    metrics: async (clientId) => ({ loadMetrics: (id) => input<MetricsInput>(id, 'platform.metrics'), tokenUsdPerReport: cost(await config(clientId), 'metricsReportUsd', 0.08), publish: async (id, report) => { const receipt = await publish(id, 'platform.metrics', report); await notify(id, report.title, report.markdown); return receipt } }),
  }
}

async function collect(reader: CrmReader, method: 'pullAccounts' | 'pullContacts' | 'pullOpportunities' | 'pullActivities'): Promise<StagedBatch> {
  let cursor: string | undefined
  let first: StagedBatch | null = null
  const all: Record<string, unknown>[] = []
  for (let page = 0; page < 100; page++) {
    const batch = await reader[method](cursor)
    first ??= batch
    all.push(...batch.rows)
    if (!batch.cursor) return { ...first, cursor: null, rows: all }
    cursor = batch.cursor
  }
  throw new Error(`${method} exceeded 100 pages`)
}

function scalarRecord(value: Record<string, unknown>): Record<string, string | number | boolean | null> {
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => item === null || ['string', 'number', 'boolean'].includes(typeof item) ? [[key, item as string | number | boolean | null]] : []))
}

function required<T>(value: T | null, name: string): T {
  if (value === null) throw new Error(`${name} runtime artifact is required`)
  return value
}

function combineReceipts(values: Array<{ provider?: string; added?: number; removed?: number; rowCount?: number; complete?: boolean }>): DispatchReceipt {
  return { affected: values.reduce((sum, value) => sum + (value.added ?? 0) + (value.removed ?? 0) + (value.rowCount ?? (value.complete ? 1 : 0)), 0), detail: `${values.length} provider operation(s)` }
}
