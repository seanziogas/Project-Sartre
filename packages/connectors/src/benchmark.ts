/**
 * REST-vs-MCP connector benchmark. Runs the same connector operation through
 * both transports N times, measuring latency and output parity so the two paths
 * can be compared head to head against the shared connector contract. Transport
 * construction is the caller's concern (see createConnectorClient) — this module
 * only drives, times, and compares.
 */

export interface BenchmarkStats {
  runs: number
  errors: number
  minMs: number
  p50Ms: number
  p95Ms: number
  maxMs: number
  meanMs: number
}

export interface BenchmarkComparison {
  iterations: number
  rest: BenchmarkStats
  mcp: BenchmarkStats
  parity: { compared: number; matched: number; mismatches: number[] }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const rank = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)]!
}

function summarize(latencies: number[], errors: number): BenchmarkStats {
  const sorted = [...latencies].sort((a, b) => a - b)
  const sum = sorted.reduce((total, value) => total + value, 0)
  return {
    runs: latencies.length,
    errors,
    minMs: sorted[0] ?? 0,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    maxMs: sorted[sorted.length - 1] ?? 0,
    meanMs: sorted.length ? sum / sorted.length : 0,
  }
}

const defaultEquals = <T>(a: T, b: T): boolean => JSON.stringify(a) === JSON.stringify(b)

/** Monotonic clock seam; performance.now() in prod, injectable for deterministic tests. */
export type Clock = () => number

/**
 * Run `iterations` of the same operation through the REST client and the MCP
 * client, timing each call and comparing their outputs for parity. A call that
 * throws is counted as an error and excluded from latency stats and parity.
 */
export async function benchmarkConnectorOperation<T>(opts: {
  iterations: number
  rest: () => Promise<T>
  mcp: () => Promise<T>
  equals?: (a: T, b: T) => boolean
  clock?: Clock
}): Promise<BenchmarkComparison> {
  if (!Number.isInteger(opts.iterations) || opts.iterations < 1) throw new Error('iterations must be a positive integer')
  const clock: Clock = opts.clock ?? (() => performance.now())
  const equals = opts.equals ?? defaultEquals
  const restLatencies: number[] = []
  const mcpLatencies: number[] = []
  let restErrors = 0
  let mcpErrors = 0
  const mismatches: number[] = []
  let compared = 0
  let matched = 0

  for (let i = 0; i < opts.iterations; i++) {
    let restOut: T | undefined
    let mcpOut: T | undefined
    let restOk = false
    let mcpOk = false

    const restStart = clock()
    try { restOut = await opts.rest(); restOk = true; restLatencies.push(clock() - restStart) } catch { restErrors++ }

    const mcpStart = clock()
    try { mcpOut = await opts.mcp(); mcpOk = true; mcpLatencies.push(clock() - mcpStart) } catch { mcpErrors++ }

    if (restOk && mcpOk) {
      compared++
      if (equals(restOut as T, mcpOut as T)) matched++
      else mismatches.push(i)
    }
  }

  return {
    iterations: opts.iterations,
    rest: summarize(restLatencies, restErrors),
    mcp: summarize(mcpLatencies, mcpErrors),
    parity: { compared, matched, mismatches },
  }
}

export function formatComparison(result: BenchmarkComparison): string {
  const row = (label: string, s: BenchmarkStats) =>
    `${label.padEnd(6)} runs=${s.runs} errors=${s.errors} p50=${s.p50Ms.toFixed(1)}ms p95=${s.p95Ms.toFixed(1)}ms mean=${s.meanMs.toFixed(1)}ms`
  return [
    `iterations: ${result.iterations}`,
    row('REST', result.rest),
    row('MCP', result.mcp),
    `parity: ${result.parity.matched}/${result.parity.compared} matched` +
      (result.parity.mismatches.length ? ` (mismatch at ${result.parity.mismatches.join(', ')})` : ''),
  ].join('\n')
}
