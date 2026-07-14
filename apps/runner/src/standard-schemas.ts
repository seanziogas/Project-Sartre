import { z } from 'zod'
import { OutcomeEvent } from '@sartre/core'
import { SourceMapping, LeadCandidate } from '@sartre/data'
import { signalWatcher, sowQbrGenerator } from '@sartre/skills'

const nonempty = z.string().min(1)
const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()])

export const StandardRuntimeConfigSchema = z.object({
  connections: z.record(nonempty),
  destinations: z.record(nonempty),
  costs: z.record(z.number().finite().nonnegative()),
  modules: z.record(z.unknown()),
}).strict()
export type StandardRuntimeConfig = z.infer<typeof StandardRuntimeConfigSchema>

const EmailTemplate = z.object({ subjects: z.array(nonempty).min(1), body: nonempty }).strict()
export const CampaignTemplatesSchema = z.object({
  email1: z.record(EmailTemplate), email2: z.record(EmailTemplate), email3: z.array(EmailTemplate).min(1),
  slotDefaults: z.record(z.string()), fallbackPlay: nonempty, fallbackGroup: nonempty,
}).strict()

const Condition: z.ZodType<unknown> = z.lazy(() => z.union([
  z.object({ all: z.array(Condition).min(1) }).strict(),
  z.object({ any: z.array(Condition).min(1) }).strict(),
  z.object({ not: Condition }).strict(),
  z.object({
    field: nonempty,
    op: z.enum(['eq', 'neq', 'in', 'gte', 'lt', 'exists', 'missing', 'matches']),
    value: z.union([scalar, z.array(z.union([z.string(), z.number()]))]).optional(),
  }).strict(),
]))
export const RoutingRulesSchema = z.object({
  rules: z.array(z.object({
    id: nonempty, description: nonempty, when: Condition,
    action: z.union([
      z.object({ type: z.literal('skip'), reason: nonempty }).strict(),
      z.object({ type: z.literal('assign'), owner: nonempty }).strict(),
      z.object({ type: z.literal('manual_review'), reason: nonempty }).strict(),
    ]),
  }).strict()),
  defaultOwner: nonempty.nullable(),
}).strict()

export const StandardModuleConfigSchemas = {
  crm: z.object({ namespacePrefix: nonempty }).strict(),
  'revops.enrichment': z.object({
    accountMapping: SourceMapping, contactMapping: SourceMapping,
    opportunityMapping: SourceMapping.optional(), activityMapping: SourceMapping.optional(),
  }).strict(),
  'sales.reactivation': z.object({
    vocabularies: z.record(z.array(nonempty)), reviewerRules: z.array(nonempty), minScore: z.number().finite(),
    defaultPlay: nonempty, defaultGroup: nonempty, campaignId: nonempty, templates: CampaignTemplatesSchema,
  }).strict(),
  'marketing.inbound': z.object({
    provider: z.enum(['qualified', 'linkedin-leadgen', 'typeform', 'chilipiper', 'marketo']),
    idField: nonempty, domainField: nonempty, nameField: nonempty, fieldsWanted: z.array(nonempty),
    clayCreditsPerCall: z.number().finite().nonnegative(), routingRules: RoutingRulesSchema,
    ownerField: nonempty, reasoningField: nonempty,
  }).strict(),
  'marketing.deanon': z.object({
    provider: z.enum(['sixsense', 'g2', 'clearbit', 'koala', 'bombora']),
    idField: nonempty, domainField: nonempty, kindField: nonempty, occurredAtField: nonempty, detailField: nonempty,
  }).strict(),
  'revops.dedup': z.object({ flagField: nonempty }).strict(),
  'sales.outbound': z.object({ templates: CampaignTemplatesSchema, campaignId: nonempty }).strict(),
  'marketing.copy-factory': z.object({ templates: CampaignTemplatesSchema }).strict(),
  'revops.routing': z.object({ rules: RoutingRulesSchema, ownerField: nonempty, reasoningField: nonempty }).strict(),
  'revops.tam': z.object({ scoreField: nonempty, tierField: nonempty, defaultScore: z.number().finite(), defaultTier: nonempty }).strict(),
  'platform.signals': z.object({ rules: z.array(signalWatcher.SignalRule) }).strict(),
} as const

const CampaignRow = z.object({
  id: nonempty, play: nonempty, group: nonempty, slots: z.record(z.string().nullable()),
  tier: z.string().optional(), doNotContact: z.boolean().optional(),
}).strict()
const SequenceLead = z.object({
  email: z.string().email(), firstName: z.string().optional(), lastName: z.string().optional(), companyName: z.string().optional(),
  customFields: z.record(scalar).optional(),
}).strict()
const NamespacedWrite = z.object({
  object: z.enum(['account', 'contact', 'opportunity']), externalId: nonempty, fields: z.record(scalar),
}).strict()

export const StandardInputSchemas = {
  'sequence-leads': z.record(SequenceLead),
  'revops.remediation': z.array(NamespacedWrite),
  'revops.lead-convert': z.array(LeadCandidate),
  'platform.learning': z.object({
    outcomes: z.array(OutcomeEvent), variantByEventId: z.record(nonempty),
    gradedOutcomes: z.array(z.object({ id: nonempty, score: z.number().min(1).max(100), converted: z.boolean() }).strict()),
  }).strict(),
  'sales.outbound': z.object({ rows: z.array(CampaignRow) }).strict(),
  'sales.abm': z.object({ accounts: z.array(z.object({ id: nonempty, name: nonempty, fields: z.record(z.unknown()) }).strict()) }).strict(),
  'sales.takeout': z.array(z.object({ accountId: nonempty, accountName: nonempty, competitor: nonempty, evidence: z.array(nonempty) }).strict()),
  'sales.rep-workflows': z.object({
    replies: z.array(z.object({ id: nonempty, sender: nonempty, message: nonempty }).strict()),
    crmActions: z.array(z.object({ id: nonempty, action: nonempty, detail: nonempty }).strict()),
  }).strict(),
  'marketing.events': z.array(z.object({ id: nonempty, email: z.string().email(), event: nonempty, attended: z.boolean(), segment: nonempty }).strict()),
  'marketing.copy-factory': z.object({ rows: z.array(CampaignRow) }).strict(),
  'marketing.ads-sync': z.array(z.object({ audience: nonempty, add: z.array(z.string().email()), remove: z.array(z.string().email()), reason: nonempty }).strict()),
  'revops.routing': z.object({ records: z.array(z.object({ id: nonempty, fields: z.record(scalar) }).strict()) }).strict(),
  'revops.tam': z.array(z.object({ id: nonempty, name: nonempty, fields: z.record(scalar) }).strict()),
  'revops.etl': z.array(z.object({ destination: nonempty, object: nonempty, externalId: nonempty, fields: z.record(z.unknown()) }).strict()),
  'platform.signals': z.object({ signals: z.array(signalWatcher.WatchedSignal) }).strict(),
  'platform.digests': z.object({ title: nonempty, markdown: nonempty, sourceRefs: z.array(nonempty).min(1) }).strict(),
  'platform.metrics': sowQbrGenerator.EngagementDocumentInput.extend({ metrics: z.record(z.number().nullable()) }).strict(),
} as const

export function parseStandardInput<K extends keyof typeof StandardInputSchemas>(key: K, value: unknown): z.infer<(typeof StandardInputSchemas)[K]> {
  return StandardInputSchemas[key].parse(value) as z.infer<(typeof StandardInputSchemas)[K]>
}
