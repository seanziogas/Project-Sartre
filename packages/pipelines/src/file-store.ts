import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { applyGateDecision } from './types.js'
import type { GateDecisionInput, RunRecord, RunnerStore, RunStatus } from './types.js'

/**
 * File-backed run store: one JSON file per run under <dir>/<clientId>/runs/.
 * Local-development adapter; production runner and ops use the Postgres store
 * behind the same interface. Tenancy note: files are partitioned by client
 * directory, and reads are always client-scoped or id-scoped.
 */
export class FileRunStore implements RunnerStore {
  constructor(private readonly dir: string) {}

  private runPath(clientId: string, runId: string): string {
    return join(this.dir, sanitize(clientId), 'runs', `${sanitize(runId)}.json`)
  }

  async get(runId: string): Promise<RunRecord | null> {
    // runId is globally unique; scan client dirs for it
    for (const clientId of await this.clients()) {
      const run = await this.getScoped(clientId, runId)
      if (run) return run
    }
    return null
  }

  async getScoped(clientId: string, runId: string): Promise<RunRecord | null> {
    try {
      return JSON.parse(await readFile(this.runPath(clientId, runId), 'utf8')) as RunRecord
    } catch {
      return null
    }
  }

  async save(run: RunRecord): Promise<void> {
    const path = this.runPath(run.clientId, run.runId)
    await mkdir(join(this.dir, sanitize(run.clientId), 'runs'), { recursive: true })
    await atomicWrite(path, JSON.stringify(run, null, 2))
  }

  async decideGate(input: GateDecisionInput): Promise<RunRecord> {
    const existing = await this.get(input.runId)
    if (!existing) throw new Error(`run ${input.runId} not found`)
    const path = this.runPath(existing.clientId, existing.runId)
    const release = await acquireLock(`${path}.lock`)
    try {
      const current = JSON.parse(await readFile(path, 'utf8')) as RunRecord
      applyGateDecision(current, input)
      await atomicWrite(path, JSON.stringify(current, null, 2))
      return current
    } finally {
      await release()
    }
  }

  async list(clientId: string): Promise<RunRecord[]> {
    const dir = join(this.dir, sanitize(clientId), 'runs')
    let files: string[]
    try {
      files = await readdir(dir)
    } catch {
      return []
    }
    const runs: RunRecord[] = []
    for (const f of files.filter((f) => f.endsWith('.json'))) {
      try {
        runs.push(JSON.parse(await readFile(join(dir, f), 'utf8')) as RunRecord)
      } catch {
        // unreadable file — skip, never crash the listing
      }
    }
    return runs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async listByStatus(status: RunStatus): Promise<RunRecord[]> {
    const all: RunRecord[] = []
    for (const clientId of await this.clients()) {
      all.push(...(await this.list(clientId)).filter((r) => r.status === status))
    }
    return all
  }

  async clients(): Promise<string[]> {
    try {
      return (await readdir(this.dir, { withFileTypes: true }))
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
    } catch {
      return []
    }
  }
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  const tmp = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(tmp, contents)
    await rename(tmp, path)
  } finally {
    await unlink(tmp).catch(() => undefined)
  }
}

async function acquireLock(path: string): Promise<() => Promise<void>> {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const handle = await open(path, 'wx')
      return async () => {
        await handle.close()
        await unlink(path).catch(() => undefined)
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      const lockStat = await stat(path).catch(() => null)
      if (lockStat && Date.now() - lockStat.mtimeMs > 30_000) {
        await unlink(path).catch(() => undefined)
        continue
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
  throw new Error(`timed out acquiring run lock ${path}`)
}

/** Keep ids filesystem-safe; anything exotic is flattened, never traversed. */
function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9 _.-]/g, '_')
}
