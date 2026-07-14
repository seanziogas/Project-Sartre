import { commerciallyRunnable, moduleRunnable } from '@sartre/core'
import type { ClientManifest } from '@sartre/core'
import type { StandardRuntimeConfig } from './standard-schemas.js'

interface ModuleProfile { gates: string[]; effects: string[]; connections: string[] }
const profiles: Record<string, ModuleProfile> = {
  'sales.outbound': { gates: ['outbound_send'], effects: ['sequence enrollment'], connections: ['sequencer'] },
  'sales.abm': { gates: ['outbound_send'], effects: ['reviewed play publication'], connections: [] },
  'sales.reactivation': { gates: ['outbound_send'], effects: ['sequence enrollment'], connections: ['sequencer'] },
  'sales.takeout': { gates: ['outbound_send'], effects: ['reviewed play publication'], connections: [] },
  'sales.copilot-briefs': { gates: ['internal_report'], effects: ['brief publication'], connections: [] },
  'sales.rep-workflows': { gates: ['outbound_send', 'crm_write'], effects: ['reviewed workflow publication'], connections: [] },
  'marketing.inbound': { gates: ['crm_write'], effects: ['CRM assignment'], connections: ['crm', 'clay', 'inbound provider'] },
  'marketing.deanon': { gates: ['internal_report'], effects: ['canonical signal persistence'], connections: ['intent provider'] },
  'marketing.events': { gates: ['outbound_send'], effects: ['email delivery'], connections: ['email'] },
  'marketing.copy-factory': { gates: ['internal_report'], effects: ['draft publication'], connections: [] },
  'marketing.ads-sync': { gates: ['outbound_send'], effects: ['audience mutation'], connections: ['audience'] },
  'revops.enrichment': { gates: ['client_comms'], effects: ['canonical refresh', 'health notification'], connections: ['crm'] },
  'revops.dedup': { gates: ['crm_write', 'internal_report'], effects: ['CRM annotation'], connections: ['crm'] },
  'revops.lead-convert': { gates: ['crm_write', 'internal_report'], effects: ['Salesforce lead conversion'], connections: ['crm'] },
  'revops.routing': { gates: ['crm_write'], effects: ['CRM assignment'], connections: ['crm'] },
  'revops.tam': { gates: ['crm_write'], effects: ['CRM score write'], connections: ['crm'] },
  'revops.etl': { gates: ['crm_write'], effects: ['warehouse statement'], connections: ['warehouse'] },
  'revops.remediation': { gates: ['crm_write', 'internal_report'], effects: ['CRM remediation write'], connections: ['crm'] },
  'platform.signals': { gates: ['internal_report'], effects: ['trigger persistence'], connections: [] },
  'platform.quality': { gates: ['client_comms'], effects: ['quality notification'], connections: ['comms'] },
  'platform.digests': { gates: ['client_comms'], effects: ['digest delivery'], connections: ['comms'] },
  'platform.learning': { gates: ['brain_change', 'internal_report'], effects: ['draft proposal persistence'], connections: [] },
  'platform.metrics': { gates: ['client_comms'], effects: ['report publication and delivery'], connections: ['comms'] },
}

export interface ClientSimulation {
  clientId: string
  generatedAt: string
  noEffects: true
  modules: Array<{
    moduleId: string
    runnable: boolean
    reason: string
    gates: string[]
    effects: string[]
    connections: Array<{ logical: string; provider: string | null; active: boolean }>
    inputPreview: unknown
  }>
  destinations: Record<string, string>
  configuredUnitCosts: Record<string, number>
  budgetCaps: ClientManifest['budgets']
  crmFields: string[]
}

export function simulateClient(
  clientId: string,
  manifest: ClientManifest,
  runtime: StandardRuntimeConfig | null,
  activeProviders: string[],
  inputs: Record<string, unknown>,
  now = new Date(),
): ClientSimulation {
  const active = new Set(activeProviders)
  const modules = Object.entries(manifest.modules).filter(([, config]) => config.enabled).map(([moduleId]) => {
    const commercial = commerciallyRunnable(manifest, moduleId)
    const mvd = moduleRunnable(manifest, moduleId)
    const runnable = commercial.runnable && mvd.runnable
    const profile = profiles[moduleId] ?? { gates: [], effects: [], connections: [] }
    return {
      moduleId, runnable, reason: commercial.runnable ? mvd.reason : commercial.reason,
      gates: profile.gates, effects: profile.effects,
      connections: profile.connections.map((logical) => {
        const provider = resolveProvider(logical, moduleId, runtime)
        return { logical, provider, active: provider !== null && active.has(provider) }
      }),
      inputPreview: previewInput(moduleId, inputs[moduleId]),
    }
  })
  return {
    clientId, generatedAt: now.toISOString(), noEffects: true, modules,
    destinations: runtime?.destinations ?? {}, configuredUnitCosts: runtime?.costs ?? {}, budgetCaps: manifest.budgets,
    crmFields: runtime ? crmFields(runtime) : [],
  }
}

function resolveProvider(logical: string, moduleId: string, runtime: StandardRuntimeConfig | null): string | null {
  if (!runtime) return null
  if (logical === 'clay') return 'clay'
  if (logical === 'inbound provider') return (runtime.modules['marketing.inbound'] as { provider?: string } | undefined)?.provider ?? null
  if (logical === 'intent provider') return (runtime.modules['marketing.deanon'] as { provider?: string } | undefined)?.provider ?? null
  return runtime.connections[logical] ?? (moduleId === 'revops.lead-convert' && logical === 'crm' ? 'salesforce' : null)
}

function previewInput(moduleId: string, value: unknown): unknown {
  if (value === undefined) return { present: false }
  if (moduleId === 'marketing.ads-sync' && Array.isArray(value)) {
    return {
      present: true,
      audiences: value.map((item) => {
        const audience = item as { audience?: unknown; add?: unknown; remove?: unknown }
        return {
          audience: audience.audience,
          add: Array.isArray(audience.add) ? audience.add.length : 0,
          remove: Array.isArray(audience.remove) ? audience.remove.length : 0,
        }
      }),
    }
  }
  if (moduleId === 'revops.etl' && Array.isArray(value)) {
    return {
      present: true,
      statements: value.map((item) => {
        const statement = item as { destination?: unknown; object?: unknown; externalId?: unknown; fields?: unknown }
        return {
          destination: statement.destination,
          object: statement.object,
          externalId: statement.externalId,
          fields: statement.fields && typeof statement.fields === 'object' ? Object.keys(statement.fields).sort() : [],
        }
      }),
    }
  }
  if (Array.isArray(value)) return { present: true, items: value.length }
  if (!value || typeof value !== 'object') return { present: true, type: typeof value }
  const record = value as Record<string, unknown>
  return { present: true, keys: Object.keys(record).sort(), counts: Object.fromEntries(Object.entries(record).filter(([, item]) => Array.isArray(item)).map(([key, item]) => [key, (item as unknown[]).length])) }
}

function crmFields(runtime: StandardRuntimeConfig): string[] {
  const keys = ['crm', 'marketing.inbound', 'revops.dedup', 'revops.routing', 'revops.tam']
  const fields = new Set<string>()
  for (const key of keys) {
    const value = runtime.modules[key]
    if (!value || typeof value !== 'object') continue
    for (const [name, field] of Object.entries(value)) {
      if ((name.endsWith('Field') || name === 'namespacePrefix') && typeof field === 'string') fields.add(field)
    }
  }
  return [...fields].sort()
}
