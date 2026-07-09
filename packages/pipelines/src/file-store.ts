import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RunRecord, RunnerStore, RunStatus } from './types.js'

/**
 * File-backed run store: one JSON file per run under <dir>/<clientId>/runs/.
 * Good enough for internal v1 and local dev; the Postgres adapter replaces it
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
    await writeFile(path, JSON.stringify(run, null, 2))
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

/** Keep ids filesystem-safe; anything exotic is flattened, never traversed. */
function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9 _.-]/g, '_')
}
