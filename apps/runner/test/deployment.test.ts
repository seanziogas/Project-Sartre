import { describe, expect, it } from 'vitest'
import { loadModuleDeps } from '../src/deployment.js'
import { buildRegistry } from '../src/registry.js'

describe('runner deployment loading', () => {
  it('starts with the production registry when no connector bundle is configured', async () => {
    const deps = await loadModuleDeps(undefined, {} as never)
    const registry = buildRegistry(deps, { complete: async () => '[]' })
    expect(registry.forModule('platform.learning')?.id).toBe('learning-loop@0.1.0')
    await expect(deps.enrichment('Acme')).rejects.toThrow('not configured for client Acme')
  })
})
