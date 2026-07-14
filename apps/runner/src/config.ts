import { resolve } from 'node:path'
import { z } from 'zod'
import { credentialKeyConfigFromEnvironment, CredentialVault } from '@sartre/connectors'
import type { CredentialKeyConfig } from '@sartre/connectors'

const Environment = z.object({
  DATABASE_URL: z.string().min(1),
  SARTRE_CLIENTS_DIR: z.string().min(1).optional(),
  SARTRE_MODULE_DEPS: z.string().optional(),
  SARTRE_CREDENTIAL_ENCRYPTION_KEY: z.string().optional(),
  SARTRE_CREDENTIAL_ENCRYPTION_KEYS: z.string().optional(),
  SARTRE_CREDENTIAL_CURRENT_KEY_ID: z.string().optional(),
  SARTRE_TICK_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(30_000),
  SARTRE_HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).default(3_001),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  OTEL_EXPORTER_OTLP_HEADERS: z.string().optional(),
}).passthrough()

export interface RunnerConfig {
  databaseUrl: string
  clientsDir: string
  moduleDeps?: string
  credentialKeys?: CredentialKeyConfig
  tickMs: number
  healthPort: number
  otlpEndpoint?: string
  otlpHeaders: Record<string, string>
}

export function loadRunnerConfig(environment: NodeJS.ProcessEnv, baseDir = process.cwd()): RunnerConfig {
  const parsed = Environment.parse(environment)
  const credentialKeys = credentialKeyConfigFromEnvironment(environment)
  if (credentialKeys) new CredentialVault(credentialKeys)
  const otlpHeaders = parsed.OTEL_EXPORTER_OTLP_HEADERS
    ? z.record(z.string(), z.string()).parse(JSON.parse(parsed.OTEL_EXPORTER_OTLP_HEADERS))
    : {}
  return {
    databaseUrl: parsed.DATABASE_URL,
    clientsDir: resolve(parsed.SARTRE_CLIENTS_DIR ?? resolve(baseDir, 'clients')),
    ...(parsed.SARTRE_MODULE_DEPS?.trim() ? { moduleDeps: parsed.SARTRE_MODULE_DEPS } : {}),
    ...(credentialKeys ? { credentialKeys } : {}),
    tickMs: parsed.SARTRE_TICK_MS,
    healthPort: parsed.SARTRE_HEALTH_PORT,
    ...(parsed.OTEL_EXPORTER_OTLP_ENDPOINT ? { otlpEndpoint: parsed.OTEL_EXPORTER_OTLP_ENDPOINT } : {}),
    otlpHeaders,
  }
}
