import { cronMatches } from './cron.js'
import { PipelineEngine } from './engine.js'
import type { ClientManifest } from '@sartre/core'
import type { PipelineDefinition, RunnerStore, RunRecord } from './types.js'

/**
 * Runner service (Layer 4). Two jobs per tick:
 *  1. Resume: runs parked awaiting_approval whose gates are all resolved get
 *     resumed (approval) or finalized (rejection) by the engine.
 *  2. Schedule: enabled modules with a cron schedule fire when the current
 *     UTC minute matches — once per minute slot per client+module.
 *
 * The ops surface records gate decisions; this service turns them into
 * execution. Restart caveat: the fired-slot ledger is in-memory, so a restart
 * inside the same minute could double-fire a schedule — runs are idempotent
 * up to their gates and every outward-facing pipeline ends in one, so the
 * blast radius is a duplicate parked run, not a duplicate send.
 */

export interface PipelineRegistry {
  byId(pipelineId: string): PipelineDefinition | undefined
  /** The pipeline a module's schedule fires. */
  forModule(moduleId: string): PipelineDefinition | undefined
}

export class MapRegistry implements PipelineRegistry {
  private readonly ids = new Map<string, PipelineDefinition>()
  private readonly modules = new Map<string, PipelineDefinition>()
  register(def: PipelineDefinition, options: { scheduledForModule?: boolean } = {}): this {
    this.ids.set(def.id, def)
    if (options.scheduledForModule ?? true) this.modules.set(def.moduleId, def)
    return this
  }
  byId(id: string) {
    return this.ids.get(id)
  }
  forModule(moduleId: string) {
    return this.modules.get(moduleId)
  }
}

export interface RunnerDeps {
  store: RunnerStore
  registry: PipelineRegistry
  /** Client id → manifest. Runner never reads files itself. */
  manifests: () => Promise<Map<string, ClientManifest>>
  engine?: PipelineEngine
  now?: () => Date
  onWarn?: (message: string) => void
  /** Called after each interval-driven tick; startup callers still own their explicit first tick. */
  onTickComplete?: (report: TickReport) => void
  /** Called when an interval-driven tick cannot complete. */
  onTickError?: (error: Error) => void
  onOperationalEvent?: (event: RunnerOperationalEvent) => void
}

export interface RunnerOperationalEvent {
  event: 'run_unresolved' | 'schedule_invalid' | 'schedule_pipeline_missing'
  fields: Record<string, string>
}

export interface TickReport {
  resumed: string[]
  scheduled: { clientId: string; pipelineId: string; runId: string }[]
  warnings: string[]
}

export class Runner {
  private readonly engine: PipelineEngine
  private readonly now: () => Date
  private readonly firedSlots = new Set<string>()
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly deps: RunnerDeps) {
    this.now = deps.now ?? (() => new Date())
    this.engine = deps.engine ?? new PipelineEngine(deps.store, { now: this.now })
  }

  async tick(): Promise<TickReport> {
    const report: TickReport = { resumed: [], scheduled: [], warnings: [] }
    const warn = (m: string, event: RunnerOperationalEvent) => {
      report.warnings.push(m)
      this.deps.onWarn?.(m)
      this.deps.onOperationalEvent?.(event)
    }
    const manifests = await this.deps.manifests()

    // 1. Resume runs whose gates have all been decided
    for (const run of await this.deps.store.listByStatus('awaiting_approval')) {
      if (run.gates.some((g) => g.status === 'pending')) continue
      const def = this.deps.registry.byId(run.pipelineId)
      if (!def) {
        warn(`run ${run.runId}: pipeline ${run.pipelineId} not in registry — cannot resume`, {
          event: 'run_unresolved', fields: { runId: run.runId, clientId: run.clientId, reason: 'pipeline_missing', pipelineId: run.pipelineId },
        })
        continue
      }
      const manifest = manifests.get(run.clientId)
      if (!manifest) {
        warn(`run ${run.runId}: no manifest for client ${run.clientId}`, {
          event: 'run_unresolved', fields: { runId: run.runId, clientId: run.clientId, reason: 'manifest_missing', pipelineId: run.pipelineId },
        })
        continue
      }
      const resumed = await this.resumeDecided(def, run, manifest)
      report.resumed.push(resumed.runId)
    }

    // 2. Fire schedules for the current minute
    const nowDate = this.now()
    const minuteSlot = nowDate.toISOString().slice(0, 16) // YYYY-MM-DDTHH:MM
    for (const [clientId, manifest] of manifests) {
      if (manifest.status !== 'active') continue
      for (const [moduleId, mod] of Object.entries(manifest.modules)) {
        if (!mod.enabled || !mod.schedule) continue
        let matches: boolean
        try {
          matches = cronMatches(mod.schedule, nowDate)
        } catch (err) {
          warn(`${clientId}/${moduleId}: bad cron "${mod.schedule}": ${(err as Error).message}`, {
            event: 'schedule_invalid', fields: { clientId, moduleId, schedule: mod.schedule, message: (err as Error).message },
          })
          continue
        }
        if (!matches) continue
        const slotKey = `${clientId}:${moduleId}:${minuteSlot}`
        if (this.firedSlots.has(slotKey)) continue
        const def = this.deps.registry.forModule(moduleId)
        if (!def) {
          warn(`${clientId}/${moduleId}: schedule fired but no pipeline registered for module`, {
            event: 'schedule_pipeline_missing', fields: { clientId, moduleId },
          })
          continue
        }
        this.firedSlots.add(slotKey)
        const run = await this.engine.start(def, manifest, clientId)
        report.scheduled.push({ clientId, pipelineId: def.id, runId: run.runId })
      }
    }

    return report
  }

  /**
   * A run is parked with all gates decided. Rejected gates terminate the run;
   * otherwise the engine re-executes the gated step, whose gate() now passes.
   */
  private async resumeDecided(def: PipelineDefinition, run: RunRecord, manifest: ClientManifest) {
    return this.engine.resume(def, run.runId, manifest)
  }

  start(intervalMs = 30_000): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.tick()
        .then((report) => this.deps.onTickComplete?.(report))
        .catch((error: unknown) => {
          const normalized = error instanceof Error ? error : new Error(String(error))
          this.deps.onWarn?.(`tick failed: ${normalized.message}`)
          this.deps.onTickError?.(normalized)
        })
    }, intervalMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
