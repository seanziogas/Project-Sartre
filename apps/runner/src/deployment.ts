import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { FileClientBrainStore } from '@sartre/core'
import type { Queryable } from '@sartre/db'
import type { TenantConnectionResolver } from './connections.js'
import type { TenantToolClients } from './tools.js'
import type { RunnerModuleDeps } from './registry.js'

export interface RunnerDeploymentContext {
  /** Shared Postgres connection for cache-backed connector adapters. */
  db: Queryable
  /** Approved, path-isolated brain documents and typed config per client. */
  brains: FileClientBrainStore
  /** Explicit, tenant-scoped credential access for deployment-owned adapters. */
  connections: TenantConnectionResolver
  /** Concrete Salesforce/HubSpot/Clay/Slack/Teams/Fathom clients, created per tenant. */
  tools: TenantToolClients
}

export interface RunnerDeploymentModule {
  createModuleDeps(
    context: RunnerDeploymentContext,
  ): RunnerModuleDeps | Promise<RunnerModuleDeps>
}

/** Load deployment-specific connector adapters without putting credentials in this repo. */
export async function loadModuleDeps(
  modulePath: string | undefined,
  context: RunnerDeploymentContext,
): Promise<RunnerModuleDeps> {
  if (!modulePath || modulePath.trim() === '') {
    return unconfiguredModuleDeps()
  }
  const url = pathToFileURL(resolve(modulePath)).href
  const loaded = await import(url) as Partial<RunnerDeploymentModule>
  if (typeof loaded.createModuleDeps !== 'function') {
    throw new Error(`${modulePath} must export createModuleDeps(context)`)
  }
  const deps = await loaded.createModuleDeps(context)
  assertModuleDeps(deps)
  return deps
}

function unconfiguredModuleDeps(): RunnerModuleDeps {
  const missing = (section: string) => async (clientId: string): Promise<never> => {
    throw new Error(`${section} dependencies are not configured for client ${clientId}; connect the required tools and configure SARTRE_MODULE_DEPS`)
  }
  return {
    enrichment: missing('enrichment'),
    reactivation: missing('reactivation'),
    inbound: missing('inbound'),
    remediation: missing('remediation'),
    copilotBriefs: missing('copilot briefs'),
    dedup: missing('dedup'),
    leadConvert: missing('lead conversion'),
    deanon: missing('de-anonymization'),
    learning: missing('learning'),
    quality: missing('quality'),
    outbound: missing('outbound'),
    abm: missing('ABM'),
    takeout: missing('competitive takeout'),
    repWorkflows: missing('rep workflows'),
    events: missing('event follow-up'),
    copyFactory: missing('copy factory'),
    adsSync: missing('ads sync'),
    routing: missing('revops routing'),
    tam: missing('TAM mapping'),
    etl: missing('reporting ETL'),
    signals: missing('signal watcher'),
    digests: missing('weekly digests'),
    metrics: missing('metrics reporting'),
  }
}

function assertModuleDeps(value: unknown): asserts value is RunnerModuleDeps {
  if (!value || typeof value !== 'object') throw new Error('createModuleDeps must return an object')
  const record = value as Record<string, unknown>
  for (const key of [
    'enrichment', 'reactivation', 'inbound', 'remediation', 'copilotBriefs',
    'dedup', 'leadConvert', 'deanon', 'learning', 'quality', 'outbound', 'abm', 'takeout',
    'repWorkflows', 'events', 'copyFactory', 'adsSync', 'routing', 'tam', 'etl', 'signals', 'digests', 'metrics',
  ]) {
    const section = record[key]
    if (typeof section !== 'function') {
      throw new Error(`createModuleDeps result must provide a per-client ${key}(clientId) resolver`)
    }
  }
}
