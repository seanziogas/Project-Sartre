import { resolve } from 'node:path'
import { z } from 'zod'

const Environment = z.object({
  DATABASE_URL: z.string().min(1),
  SARTRE_CLIENTS_DIR: z.string().min(1).optional(),
  SARTRE_MODULE_DEPS: z.string().optional(),
  SARTRE_CREDENTIAL_ENCRYPTION_KEY: z.string().optional(),
  SARTRE_TICK_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(30_000),
  SARTRE_HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).default(3_001),
}).passthrough()

export interface RunnerConfig {
  databaseUrl: string
  clientsDir: string
  moduleDeps?: string
  encryptionKey?: string
  tickMs: number
  healthPort: number
}

export function loadRunnerConfig(environment: NodeJS.ProcessEnv, baseDir = process.cwd()): RunnerConfig {
  const parsed = Environment.parse(environment)
  if (parsed.SARTRE_CREDENTIAL_ENCRYPTION_KEY) {
    const key = Buffer.from(parsed.SARTRE_CREDENTIAL_ENCRYPTION_KEY, 'base64')
    if (key.length !== 32) throw new Error('SARTRE_CREDENTIAL_ENCRYPTION_KEY must be 32 bytes encoded as base64')
  }
  return {
    databaseUrl: parsed.DATABASE_URL,
    clientsDir: resolve(parsed.SARTRE_CLIENTS_DIR ?? resolve(baseDir, 'clients')),
    ...(parsed.SARTRE_MODULE_DEPS?.trim() ? { moduleDeps: parsed.SARTRE_MODULE_DEPS } : {}),
    ...(parsed.SARTRE_CREDENTIAL_ENCRYPTION_KEY ? { encryptionKey: parsed.SARTRE_CREDENTIAL_ENCRYPTION_KEY } : {}),
    tickMs: parsed.SARTRE_TICK_MS,
    healthPort: parsed.SARTRE_HEALTH_PORT,
  }
}
