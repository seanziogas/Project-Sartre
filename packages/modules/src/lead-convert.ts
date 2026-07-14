import { LeadConversionRequest } from '@sartre/connectors'
import type { LeadConverter, LeadConversionReceipt } from '@sartre/connectors'
import { planLeadConversions } from '@sartre/data'
import type { LeadCandidate, LeadConversionPlan } from '@sartre/data'
import type { Account, Contact } from '@sartre/core'
import type { PipelineDefinition } from '@sartre/pipelines'
import { resolveClientDeps } from './client-deps.js'
import type { ClientDeps } from './client-deps.js'

export interface LeadConversionInput {
  leads: LeadCandidate[]
  accounts: Account[]
  contacts: Contact[]
}

export interface LeadConvertDeps {
  sourceSystem: string
  /** Pulls and stages the raw lead batch before returning mapped candidates plus canonical references. */
  loadConversionInput(clientId: string): Promise<LeadConversionInput>
  converter: Pick<LeadConverter, 'snapshotLeads' | 'convertLeads'>
}

/** revops.lead-convert — exact-match plan → snapshot → HUMAN GATE → CRM conversion. */
export function buildLeadConvertPipeline(source: ClientDeps<LeadConvertDeps>): PipelineDefinition {
  return {
    id: 'lead-convert@0.1.0',
    moduleId: 'revops.lead-convert',
    steps: [
      {
        id: 'load',
        run: async (ctx) => (await resolveClientDeps(source, ctx.clientId)).loadConversionInput(ctx.clientId),
      },
      {
        id: 'plan',
        run: async (ctx) => {
          const deps = await resolveClientDeps(source, ctx.clientId)
          const input = ctx.outputs.load as LeadConversionInput
          if (!deps.sourceSystem.trim() || input.leads.some((lead) => lead.sourceSystem !== deps.sourceSystem)) {
            throw new Error('lead candidates do not match the configured conversion source system')
          }
          return planLeadConversions(ctx.clientId, input.leads, input.accounts, input.contacts)
        },
      },
      {
        id: 'snapshot',
        run: async (ctx) => {
          const deps = await resolveClientDeps(source, ctx.clientId)
          const plan = ctx.outputs.plan as LeadConversionPlan
          const requests = plan.requests.map((request) => LeadConversionRequest.parse(request))
          return requests.length === 0 ? null : deps.converter.snapshotLeads(requests)
        },
      },
      {
        id: 'review',
        run: async (ctx) => {
          const plan = ctx.outputs.plan as LeadConversionPlan
          const snapshotRef = ctx.outputs.snapshot as string | null
          if (plan.decisions.length === 0) return { action: 'none' }
          const payload = { ...plan, snapshotRef }
          await ctx.gate(plan.requests.length === 0 ? 'internal_report' : 'crm_write', payload)
          return payload
        },
      },
      {
        id: 'convert',
        effect: true,
        run: async (ctx) => {
          const deps = await resolveClientDeps(source, ctx.clientId)
          const plan = ctx.outputs.plan as LeadConversionPlan
          const snapshotRef = ctx.outputs.snapshot as string | null
          if (plan.requests.length === 0) {
            return { converted: 0, rejected: [], snapshotRef: null }
          }
          if (!snapshotRef) throw new Error('lead conversion requires a source snapshot')
          return deps.converter.convertLeads(plan.requests, snapshotRef) as Promise<LeadConversionReceipt>
        },
      },
    ],
  }
}
