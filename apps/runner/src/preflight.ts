import type { ClientManifest } from '@sartre/core'
import type { StandardRuntimeConfig } from './standard-schemas.js'
import { StandardModuleConfigSchemas } from './standard-schemas.js'
import { cronMatches } from '@sartre/pipelines'

export interface PreflightIssue {
  severity: 'error' | 'warning'
  clientId: string
  scope: string
  message: string
}

export interface PreflightDependencies {
  manifests: Map<string, ClientManifest>
  manifestProblems?: Array<{ clientId: string; error: string }>
  loadRuntime(clientId: string): Promise<StandardRuntimeConfig>
  listConnectionProviders(clientId: string): Promise<string[]>
  validateBrainContext(clientId: string, paths: string[]): Promise<void>
}

export interface PreflightReport {
  ok: boolean
  clientsChecked: number
  issues: PreflightIssue[]
}

const configSchemaByModule: Partial<Record<string, keyof typeof StandardModuleConfigSchemas>> = {
  'revops.enrichment': 'revops.enrichment',
  'sales.reactivation': 'sales.reactivation',
  'marketing.inbound': 'marketing.inbound',
  'marketing.deanon': 'marketing.deanon',
  'revops.dedup': 'revops.dedup',
  'sales.outbound': 'sales.outbound',
  'marketing.copy-factory': 'marketing.copy-factory',
  'revops.routing': 'revops.routing',
  'revops.tam': 'revops.tam',
  'platform.signals': 'platform.signals',
}

const crmModules = new Set([
  'revops.enrichment', 'revops.remediation', 'revops.dedup', 'revops.lead-convert',
  'revops.routing', 'revops.tam', 'marketing.inbound',
])
const runtimeModules = new Set([
  ...crmModules, 'sales.reactivation', 'sales.copilot-briefs', 'marketing.deanon',
  'platform.quality', 'sales.outbound', 'sales.rep-workflows', 'marketing.events',
  'marketing.copy-factory', 'marketing.ads-sync', 'revops.etl', 'platform.signals',
  'platform.digests', 'platform.metrics',
])
const brainContexts: Partial<Record<string, string[]>> = {
  'sales.reactivation': ['icp.md', 'grading.md', 'use-cases.md'],
  'sales.copilot-briefs': ['company.md', 'icp.md', 'voice.md', 'use-cases.md'],
  'sales.rep-workflows': ['company.md', 'voice.md', 'use-cases.md'],
}

export async function runDeploymentPreflight(deps: PreflightDependencies): Promise<PreflightReport> {
  const issues: PreflightIssue[] = (deps.manifestProblems ?? []).map((problem) => ({
    severity: 'error', clientId: problem.clientId, scope: 'manifest', message: problem.error,
  }))
  let clientsChecked = 0

  for (const [clientId, manifest] of deps.manifests) {
    if (manifest.status !== 'active') {
      issues.push({ severity: 'warning', clientId, scope: 'manifest', message: `status ${manifest.status}; runtime preflight skipped` })
      continue
    }
    clientsChecked++
    const enabled = Object.entries(manifest.modules).filter(([, module]) => module.enabled).map(([moduleId]) => moduleId)
    validateSchedules(clientId, manifest, issues)

    for (const moduleId of enabled) {
      const paths = brainContexts[moduleId]
      if (!paths) continue
      try {
        await deps.validateBrainContext(clientId, paths)
      } catch (error) {
        issues.push({ severity: 'error', clientId, scope: moduleId, message: errorMessage(error) })
      }
    }

    if (!enabled.some((moduleId) => runtimeModules.has(moduleId))) continue
    let runtime: StandardRuntimeConfig
    try {
      runtime = await deps.loadRuntime(clientId)
    } catch (error) {
      issues.push({ severity: 'error', clientId, scope: 'standard-runtime', message: errorMessage(error) })
      continue
    }

    validateModuleConfigs(clientId, enabled, runtime, issues)
    let connected: Set<string>
    try {
      connected = new Set(await deps.listConnectionProviders(clientId))
    } catch (error) {
      issues.push({ severity: 'error', clientId, scope: 'connections', message: errorMessage(error) })
      continue
    }
    validateConnections(clientId, enabled, runtime, connected, issues)
  }

  return { ok: !issues.some((issue) => issue.severity === 'error'), clientsChecked, issues }
}

function validateSchedules(clientId: string, manifest: ClientManifest, issues: PreflightIssue[]): void {
  for (const [moduleId, module] of Object.entries(manifest.modules)) {
    if (!module.enabled || !module.schedule) continue
    try {
      cronMatches(module.schedule, new Date('2026-01-01T00:00:00Z'))
    } catch (error) {
      issues.push({ severity: 'error', clientId, scope: moduleId, message: `invalid schedule: ${errorMessage(error)}` })
    }
  }
}

function validateModuleConfigs(clientId: string, enabled: string[], runtime: StandardRuntimeConfig, issues: PreflightIssue[]): void {
  if (enabled.some((moduleId) => crmModules.has(moduleId))) parseConfig(clientId, 'crm', runtime.modules.crm, issues)
  for (const moduleId of enabled) {
    const schemaKey = configSchemaByModule[moduleId]
    if (schemaKey) parseConfig(clientId, schemaKey, runtime.modules[moduleId], issues)
  }
}

function parseConfig(clientId: string, key: keyof typeof StandardModuleConfigSchemas, value: unknown, issues: PreflightIssue[]): void {
  const result = StandardModuleConfigSchemas[key].safeParse(value)
  if (!result.success) issues.push({
    severity: 'error', clientId, scope: key,
    message: `invalid module config: ${result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`).join('; ')}`,
  })
}

function validateConnections(
  clientId: string,
  enabled: string[],
  runtime: StandardRuntimeConfig,
  connected: Set<string>,
  issues: PreflightIssue[],
): void {
  const requireConnection = (moduleId: string, logical: string, allowed: string[]) => {
    const provider = runtime.connections[logical]
    if (!provider || !allowed.includes(provider)) {
      issues.push({ severity: 'error', clientId, scope: moduleId, message: `${logical} must be one of: ${allowed.join(', ')}` })
    } else if (!connected.has(provider)) {
      issues.push({ severity: 'error', clientId, scope: moduleId, message: `active ${provider} connection is missing` })
    }
  }
  for (const moduleId of enabled) {
    if (crmModules.has(moduleId)) requireConnection(moduleId, 'crm', moduleId === 'revops.lead-convert' ? ['salesforce'] : ['salesforce', 'hubspot', 'attio'])
    if (moduleId === 'sales.reactivation' || moduleId === 'sales.outbound') requireConnection(moduleId, 'sequencer', ['smartlead', 'instantly', 'outreach', 'salesloft', 'apollo', 'heyreach', 'lemlist', 'mailshake'])
    if (moduleId === 'marketing.inbound') {
      const provider = (runtime.modules['marketing.inbound'] as { provider?: string } | undefined)?.provider
      if (provider) requireDirectProvider(moduleId, provider, connected, clientId, issues)
      requireDirectProvider(moduleId, 'clay', connected, clientId, issues)
    }
    if (moduleId === 'marketing.deanon') {
      const provider = (runtime.modules['marketing.deanon'] as { provider?: string } | undefined)?.provider
      if (provider) requireDirectProvider(moduleId, provider, connected, clientId, issues)
    }
    if (['platform.quality', 'platform.digests', 'platform.metrics'].includes(moduleId)) {
      requireConnection(moduleId, 'comms', ['slack', 'teams', 'gmail', 'microsoft-email'])
      const provider = runtime.connections.comms
      const destination = provider === 'gmail' || provider === 'microsoft-email' ? 'email' : 'comms'
      if (!runtime.destinations[destination]) issues.push({ severity: 'error', clientId, scope: moduleId, message: `${destination} destination is required` })
    }
    if (moduleId === 'marketing.events') requireConnection(moduleId, 'email', ['gmail', 'microsoft-email'])
    if (moduleId === 'marketing.ads-sync') requireConnection(moduleId, 'audience', ['linkedin-ads', 'google-ads', 'meta-ads'])
    if (moduleId === 'revops.etl') requireConnection(moduleId, 'warehouse', ['snowflake', 'bigquery', 'databricks', 'redshift'])
  }
}

function requireDirectProvider(moduleId: string, provider: string, connected: Set<string>, clientId: string, issues: PreflightIssue[]) {
  if (!connected.has(provider)) issues.push({ severity: 'error', clientId, scope: moduleId, message: `active ${provider} connection is missing` })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
