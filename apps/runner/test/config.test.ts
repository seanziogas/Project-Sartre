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
    const key = Buffer.alloc(32, 1).toString('base64')
    expect(loadRunnerConfig({ DATABASE_URL: 'x', SARTRE_CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({ current: key }), SARTRE_CREDENTIAL_CURRENT_KEY_ID: 'current' })).toMatchObject({
      credentialKeys: { currentKeyId: 'current', keys: { current: key } },
    })
  })

  it('parses optional OTLP collector configuration without exposing headers elsewhere', () => {
    expect(loadRunnerConfig({
      DATABASE_URL: 'x', OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.example.com',
      OTEL_EXPORTER_OTLP_HEADERS: JSON.stringify({ Authorization: 'Bearer fake-test-token' }),
    })).toMatchObject({ otlpEndpoint: 'https://collector.example.com', otlpHeaders: { Authorization: 'Bearer fake-test-token' } })
    expect(() => loadRunnerConfig({ DATABASE_URL: 'x', OTEL_EXPORTER_OTLP_HEADERS: 'not-json' })).toThrow()
  })
})
