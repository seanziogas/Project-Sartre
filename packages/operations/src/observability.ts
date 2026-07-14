import { randomUUID } from 'node:crypto'
import { z } from 'zod'

export type TelemetryAttribute = string | number | boolean
export type TelemetryAttributes = Record<string, TelemetryAttribute>

export interface Telemetry {
  span<T>(name: string, attributes: TelemetryAttributes, operation: () => Promise<T>): Promise<T>
  counter(name: string, value: number, attributes?: TelemetryAttributes): Promise<void>
  gauge(name: string, value: number, attributes?: TelemetryAttributes): Promise<void>
}

export class NoopTelemetry implements Telemetry {
  span<T>(_name: string, _attributes: TelemetryAttributes, operation: () => Promise<T>): Promise<T> { return operation() }
  async counter(): Promise<void> {}
  async gauge(): Promise<void> {}
}

/** Observability must not make the delivery path unavailable. */
export class ResilientTelemetry implements Telemetry {
  constructor(private readonly delegate: Telemetry, private readonly onError: (error: Error) => void = () => {}) {}
  async span<T>(name: string, attributes: TelemetryAttributes, operation: () => Promise<T>): Promise<T> {
    let result: T | undefined
    let operationError: unknown
    try {
      return await this.delegate.span(name, attributes, async () => {
        try {
          result = await operation()
          return result
        } catch (error) {
          operationError = error
          throw error
        }
      })
    } catch (error) {
      if (operationError) throw error
      this.onError(error instanceof Error ? error : new Error(String(error)))
      return result as T
    }
  }
  async counter(name: string, value: number, attributes?: TelemetryAttributes): Promise<void> {
    try { await this.delegate.counter(name, value, attributes) } catch (error) { this.onError(error instanceof Error ? error : new Error(String(error))) }
  }
  async gauge(name: string, value: number, attributes?: TelemetryAttributes): Promise<void> {
    try { await this.delegate.gauge(name, value, attributes) } catch (error) { this.onError(error instanceof Error ? error : new Error(String(error))) }
  }
}

export interface OtlpTransport {
  send(path: '/v1/traces' | '/v1/metrics', body: unknown): Promise<void>
}

export class HttpOtlpTransport implements OtlpTransport {
  constructor(
    private readonly endpoint: string,
    private readonly headers: Record<string, string> = {},
    private readonly request: typeof fetch = fetch,
  ) {
    if (!/^https?:\/\//.test(endpoint)) throw new Error('OTLP endpoint must be HTTP(S)')
  }

  async send(path: '/v1/traces' | '/v1/metrics', body: unknown): Promise<void> {
    const response = await this.request(`${this.endpoint.replace(/\/$/, '')}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...this.headers }, body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error(`OTLP export failed with HTTP ${response.status}`)
  }
}

/** Minimal OTLP/HTTP JSON producer with W3C-sized trace/span identifiers. */
export class OtlpTelemetry implements Telemetry {
  constructor(
    private readonly transport: OtlpTransport,
    private readonly serviceName: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async span<T>(name: string, attributes: TelemetryAttributes, operation: () => Promise<T>): Promise<T> {
    const traceId = randomUUID().replaceAll('-', '')
    const spanId = randomUUID().replaceAll('-', '').slice(0, 16)
    const start = this.now()
    let status = { code: 1 }
    let result: T | undefined
    let operationError: unknown
    try {
      result = await operation()
    } catch (error) {
      status = { code: 2 }
      operationError = error
    }
    const end = this.now()
    try {
      await this.transport.send('/v1/traces', {
        resourceSpans: [{
          resource: { attributes: otlpAttributes({ 'service.name': this.serviceName }) },
          scopeSpans: [{ scope: { name: '@sartre/operations' }, spans: [{
            traceId, spanId, name, kind: 1,
            startTimeUnixNano: toNanos(start), endTimeUnixNano: toNanos(end),
            attributes: otlpAttributes(attributes), status,
          }] }],
        }],
      })
    } catch (exportError) {
      if (!operationError) throw exportError
    }
    if (operationError) throw operationError
    return result as T
  }

  counter(name: string, value: number, attributes: TelemetryAttributes = {}): Promise<void> {
    return this.metric(name, value, attributes, true)
  }

  gauge(name: string, value: number, attributes: TelemetryAttributes = {}): Promise<void> {
    return this.metric(name, value, attributes, false)
  }

  private metric(name: string, value: number, attributes: TelemetryAttributes, monotonic: boolean): Promise<void> {
    const point = { timeUnixNano: toNanos(this.now()), asDouble: value, attributes: otlpAttributes(attributes) }
    const metric = monotonic
      ? { name, sum: { aggregationTemporality: 1, isMonotonic: true, dataPoints: [point] } }
      : { name, gauge: { dataPoints: [point] } }
    return this.transport.send('/v1/metrics', {
      resourceMetrics: [{
        resource: { attributes: otlpAttributes({ 'service.name': this.serviceName }) },
        scopeMetrics: [{ scope: { name: '@sartre/operations' }, metrics: [metric] }],
      }],
    })
  }
}

export const SloDefinition = z.object({
  id: z.string().min(1), name: z.string().min(1), target: z.number().min(0).max(1), windowHours: z.number().int().positive(),
})
export type SloDefinition = z.infer<typeof SloDefinition>

export interface SloRunLike { status: string; createdAt: string; updatedAt: string; gates?: Array<{ status: string }> }
export interface SloResult extends SloDefinition { value: number; passing: boolean; numerator: number; denominator: number; detail: string }

export const DEFAULT_SLOS: SloDefinition[] = [
  { id: 'run-success', name: 'Run success rate', target: 0.95, windowHours: 24 * 7 },
  { id: 'decision-latency', name: 'Resolved-or-fresh approval rate', target: 0.90, windowHours: 24 },
  { id: 'execution-freshness', name: 'Active run freshness', target: 0.99, windowHours: 24 * 7 },
]

export function evaluateSlos(runs: SloRunLike[], definitions = DEFAULT_SLOS, now = new Date()): SloResult[] {
  return definitions.map((definition) => {
    const start = now.getTime() - definition.windowHours * 3_600_000
    const window = runs.filter((run) => Date.parse(run.createdAt) >= start)
    let numerator = 0
    let denominator = window.length
    let detail = ''
    if (definition.id === 'run-success') {
      const terminal = window.filter((run) => ['completed', 'failed'].includes(run.status))
      denominator = terminal.length
      numerator = terminal.filter((run) => run.status === 'completed').length
      detail = `${numerator}/${denominator} terminal runs completed`
    } else if (definition.id === 'decision-latency') {
      const approvals = window.filter((run) => run.gates?.length)
      denominator = approvals.length
      numerator = approvals.filter((run) => run.status !== 'awaiting_approval' || now.getTime() - Date.parse(run.updatedAt) <= 24 * 3_600_000).length
      detail = `${numerator}/${denominator} approval runs resolved or younger than 24h`
    } else if (definition.id === 'execution-freshness') {
      numerator = window.filter((run) => ['completed', 'failed', 'rejected', 'blocked'].includes(run.status) || now.getTime() - Date.parse(run.updatedAt) <= 24 * 3_600_000).length
      detail = `${numerator}/${denominator} runs terminal or updated within 24h`
    } else {
      throw new Error(`unsupported SLO ${definition.id}`)
    }
    const value = denominator === 0 ? 1 : numerator / denominator
    return { ...definition, value, passing: value >= definition.target, numerator, denominator, detail }
  })
}

function toNanos(date: Date): string { return String(BigInt(date.getTime()) * 1_000_000n) }
function otlpAttributes(attributes: TelemetryAttributes) {
  return Object.entries(attributes).map(([key, value]) => ({ key, value: typeof value === 'string' ? { stringValue: value } : typeof value === 'boolean' ? { boolValue: value } : { doubleValue: value } }))
}
