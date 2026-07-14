import { describe, expect, it } from 'vitest'
import { loadRunnerConfig } from '../src/config.js'

describe('runner environment validation', () => {
  it('loads bounded defaults and resolves the client directory', () => {
    expect(loadRunnerConfig({ DATABASE_URL: 'postgres://localhost/sartre' }, '/srv/sartre')).toMatchObject({
      databaseUrl: 'postgres://localhost/sartre', clientsDir: '/srv/sartre/clients', tickMs: 30_000, healthPort: 3_001,
    })
  })

  it('rejects unsafe intervals, ports, and malformed encryption keys at startup', () => {
    expect(() => loadRunnerConfig({ DATABASE_URL: 'x', SARTRE_TICK_MS: '1' })).toThrow()
    expect(() => loadRunnerConfig({ DATABASE_URL: 'x', SARTRE_HEALTH_PORT: '70000' })).toThrow()
    expect(() => loadRunnerConfig({ DATABASE_URL: 'x', SARTRE_CREDENTIAL_ENCRYPTION_KEY: 'bad' })).toThrow('32 bytes')
  })
})
