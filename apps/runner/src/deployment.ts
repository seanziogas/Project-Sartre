import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Queryable } from '@sartre/db'
import type { RunnerModuleDeps } from './registry.js'

export interface RunnerDeploymentContext {
  /** Shared Postgres connection for cache-backed connector adapters. */
  db: Queryable
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
    throw new Error('SARTRE_MODULE_DEPS is required for the runner')
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

function assertModuleDeps(value: unknown): asserts value is RunnerModuleDeps {
  if (!value || typeof value !== 'object') throw new Error('createModuleDeps must return an object')
  const record = value as Record<string, unknown>
  for (const key of ['enrichment', 'reactivation', 'inbound']) {
    if (!record[key] || typeof record[key] !== 'object') {
      throw new Error(`createModuleDeps result is missing ${key} dependencies`)
    }
  }
}
