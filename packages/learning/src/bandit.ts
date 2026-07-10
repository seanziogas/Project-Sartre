import type { OutcomeEvent } from '@sartre/core'

/**
 * Learning speed 3a — outcome optimization (Layer 8). Bandit-style
 * allocation for plays / subject lines / channels, driven by reply and
 * meeting outcomes. Thompson sampling over Beta posteriors: variants earn
 * traffic in proportion to the probability they're actually best, so
 * exploration decays as evidence accumulates.
 *
 * Guardrails: allocation only ever changes MIX between variants a human
 * already approved — new copy still enters through the review queue. A
 * minimum floor keeps every live variant observable (no premature death).
 */

export interface VariantStats {
  variant: string
  successes: number
  failures: number
}

/** Aggregate outcome events into per-variant successes/failures. */
export function aggregateOutcomes(
  outcomes: OutcomeEvent[],
  variantOf: (event: OutcomeEvent) => string | null,
  isSuccess: (event: OutcomeEvent) => boolean = (e) =>
    ['reply_positive', 'meeting_booked', 'opportunity_created', 'closed_won'].includes(e.outcome),
): VariantStats[] {
  const byVariant = new Map<string, { successes: number; failures: number }>()
  for (const event of outcomes) {
    const variant = variantOf(event)
    if (variant === null) continue
    const stats = byVariant.get(variant) ?? { successes: 0, failures: 0 }
    if (isSuccess(event)) stats.successes++
    else stats.failures++
    byVariant.set(variant, stats)
  }
  return [...byVariant].map(([variant, s]) => ({ variant, ...s })).sort((a, b) => a.variant.localeCompare(b.variant))
}

export interface AllocationOptions {
  /** Monte-carlo draws per variant. Default 4000. */
  draws?: number
  /** Every variant keeps at least this share (observability floor). Default 0.05. */
  minShare?: number
  /** Uniform prior pseudo-counts. Default alpha=1, beta=1. */
  priorAlpha?: number
  priorBeta?: number
  /** Injectable RNG for deterministic tests. Default Math.random. */
  rng?: () => number
}

export interface Allocation {
  variant: string
  share: number
  /** Posterior mean success rate. */
  rate: number
  observations: number
}

/** Thompson sampling: share = P(variant is best), floored and renormalized. */
export function thompsonAllocate(stats: VariantStats[], options: AllocationOptions = {}): Allocation[] {
  if (stats.length === 0) return []
  const draws = options.draws ?? 4000
  const minShare = options.minShare ?? 0.05
  const a0 = options.priorAlpha ?? 1
  const b0 = options.priorBeta ?? 1
  const rng = options.rng ?? Math.random

  const wins = new Array<number>(stats.length).fill(0)
  for (let d = 0; d < draws; d++) {
    let best = 0
    let bestSample = -1
    for (let i = 0; i < stats.length; i++) {
      const s = stats[i]!
      const sample = betaSample(a0 + s.successes, b0 + s.failures, rng)
      if (sample > bestSample) {
        bestSample = sample
        best = i
      }
    }
    wins[best]!++
  }

  // guaranteed floor: every variant gets minShare, the remainder splits by win rate
  const remainder = Math.max(0, 1 - minShare * stats.length)
  const shares = wins.map((w) => minShare + remainder * (w / draws))

  return stats
    .map((s, i) => ({
      variant: s.variant,
      share: round3(shares[i]!),
      rate: round3((a0 + s.successes) / (a0 + b0 + s.successes + s.failures)),
      observations: s.successes + s.failures,
    }))
    .sort((a, b) => b.share - a.share)
}

export function renderAllocationReport(kind: string, allocations: Allocation[]): string {
  return [
    `# Allocation update — ${kind}`,
    '',
    'Shares reflect the probability each variant is best given outcomes so far (Thompson sampling, 5% observability floor). Mix changes only — all variants passed review before going live.',
    '',
    '| variant | share | observed rate | n |',
    '|---|---|---|---|',
    ...allocations.map((a) => `| ${a.variant} | ${Math.round(a.share * 100)}% | ${Math.round(a.rate * 100)}% | ${a.observations} |`),
    '',
  ].join('\n')
}

/** Beta(a,b) sampling via two gamma draws (Marsaglia–Tsang). */
function betaSample(a: number, b: number, rng: () => number): number {
  const x = gammaSample(a, rng)
  const y = gammaSample(b, rng)
  return x / (x + y)
}

function gammaSample(shape: number, rng: () => number): number {
  if (shape < 1) {
    const u = nonZero(rng)
    return gammaSample(shape + 1, rng) * Math.pow(u, 1 / shape)
  }
  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  for (;;) {
    const x = normalSample(rng)
    const v = Math.pow(1 + c * x, 3)
    if (v <= 0) continue
    const u = nonZero(rng)
    if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v
  }
}

function normalSample(rng: () => number): number {
  const u1 = nonZero(rng)
  const u2 = rng()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

function nonZero(rng: () => number): number {
  const u = rng()
  return u === 0 ? Number.MIN_VALUE : u
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

/** Deterministic RNG for tests (mulberry32). */
export function seededRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
