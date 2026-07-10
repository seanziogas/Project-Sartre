/**
 * Learning speed 3b — ICP score recalibration (Layer 8). Compares grades
 * against what actually happened as deals close: per-band conversion rates,
 * inversion detection (a lower band converting better than a higher one),
 * and evidence-carrying proposals. Like weekly tuning: proposals only,
 * never silent changes.
 */

export interface GradedOutcome {
  id: string
  /** Score at grading time (1-100). */
  score: number
  /** Did the account produce a meaningful outcome (opportunity/meeting/won)? */
  converted: boolean
}

export interface BandConversion {
  band: string
  min: number
  max: number
  n: number
  conversions: number
  rate: number
}

export interface CalibrationResult {
  bands: BandConversion[]
  /** Pairs where a LOWER band out-converts a higher one (with enough data). */
  inversions: { higher: string; lower: string; higherRate: number; lowerRate: number }[]
  proposals: string[]
  sampleSize: number
}

const DEFAULT_BANDS = [
  { band: 'A', min: 81, max: 100 },
  { band: 'B', min: 66, max: 80 },
  { band: 'C', min: 41, max: 65 },
  { band: 'D', min: 21, max: 40 },
  { band: 'X', min: 1, max: 20 },
]

export interface CalibrationOptions {
  bands?: typeof DEFAULT_BANDS
  /** Bands with fewer outcomes than this don't drive proposals. Default 20. */
  minBandSamples?: number
}

export function recalibrateIcp(outcomes: GradedOutcome[], options: CalibrationOptions = {}): CalibrationResult {
  const bandDefs = options.bands ?? DEFAULT_BANDS
  const minSamples = options.minBandSamples ?? 20

  const bands: BandConversion[] = bandDefs.map((b) => {
    const inBand = outcomes.filter((o) => o.score >= b.min && o.score <= b.max)
    const conversions = inBand.filter((o) => o.converted).length
    return {
      band: b.band,
      min: b.min,
      max: b.max,
      n: inBand.length,
      conversions,
      rate: inBand.length === 0 ? 0 : round3(conversions / inBand.length),
    }
  })

  // ordered high→low; inversion = lower band with materially better rate, both sampled
  const inversions: CalibrationResult['inversions'] = []
  for (let hi = 0; hi < bands.length; hi++) {
    for (let lo = hi + 1; lo < bands.length; lo++) {
      const higher = bands[hi]!
      const lower = bands[lo]!
      if (higher.n < minSamples || lower.n < minSamples) continue
      if (lower.rate > higher.rate * 1.25 && lower.rate - higher.rate >= 0.02) {
        inversions.push({ higher: higher.band, lower: lower.band, higherRate: higher.rate, lowerRate: lower.rate })
      }
    }
  }

  const proposals: string[] = []
  for (const inv of inversions) {
    proposals.push(
      `Band inversion: ${inv.lower} converts at ${pct(inv.lowerRate)} vs ${inv.higher} at ${pct(inv.higherRate)}. ` +
        `The scoring signal separating ${inv.higher} from ${inv.lower} is not predicting outcomes — review the grading rulebook's floor rules and the ${inv.higher}-band criteria against the converting ${inv.lower} accounts.`,
    )
  }
  const a = bands.find((b) => b.band === 'A')
  const x = bands.find((b) => b.band === 'X')
  if (a && x && a.n >= minSamples && x.n >= minSamples && a.rate > 0 && x.rate >= a.rate * 0.8) {
    proposals.push(
      `X-band accounts convert nearly as well as A-band (${pct(x.rate)} vs ${pct(a.rate)}) — hard disqualifiers may be rejecting viable accounts; audit X-band conversions against the auto-fail list.`,
    )
  }

  return { bands, inversions, proposals, sampleSize: outcomes.length }
}

export function renderCalibrationReport(clientName: string, date: string, result: CalibrationResult): string {
  return [
    `# ICP Calibration — ${clientName} (${date})`,
    '',
    `Sample: ${result.sampleSize} graded accounts with observed outcomes.`,
    '',
    '| band | range | n | conversions | rate |',
    '|---|---|---|---|---|',
    ...result.bands.map((b) => `| ${b.band} | ${b.min}-${b.max} | ${b.n} | ${b.conversions} | ${pct(b.rate)} |`),
    '',
    result.proposals.length === 0
      ? 'Scoring is directionally consistent with outcomes — no calibration proposals.'
      : `## Proposals (reviewable — nothing applies automatically)\n\n${result.proposals.map((p, i) => `${i + 1}. ${p}`).join('\n')}`,
    '',
  ].join('\n')
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}
