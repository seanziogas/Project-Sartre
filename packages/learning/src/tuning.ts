import type { HumanActionEvent } from '@sartre/core'

/**
 * Learning speed 2 — weekly rule/threshold tuning (Layer 8). Analyzes
 * override patterns and PROPOSES diffs to the brain; a GTME approves or
 * rejects. Never silent self-modification: output is evidence-carrying
 * proposals, and callers must run the relevant skill eval set before a
 * proposal is even surfaced (the evalGate hook).
 */

export interface TuningProposal {
  kind: 'grading_bias' | 'grading_segment' | 'routing_rule'
  /** Where the change lands, e.g. "brain/grading.md" or "brain/routing.md". */
  target: string
  summary: string
  /** Concrete reviewable change, phrased as a diff to the brain. */
  proposedChange: string
  evidence: {
    eventIds: string[]
    sampleSize: number
    detail: string
  }
}

export interface TuningOptions {
  /** Minimum overrides before a pattern becomes a proposal. Default 8. */
  minSamples?: number
  /** Mean |score delta| below this is noise, not bias. Default 8 points. */
  minMeanShift?: number
}

interface GradeOverride {
  event: HumanActionEvent
  machineScore: number
  humanScore: number
  segment: string | null // e.g. an industry label on the machine output
}

/**
 * Weekly tuning pass over grade_override and routing_correction events.
 * Deterministic analysis — no LLM. Statistical honesty over cleverness:
 * report direction, magnitude, and sample size; let the human decide.
 */
export function proposeTuning(events: HumanActionEvent[], options: TuningOptions = {}): TuningProposal[] {
  const minSamples = options.minSamples ?? 8
  const minMeanShift = options.minMeanShift ?? 8
  const proposals: TuningProposal[] = []

  // ---- grading bias (global and per-segment) ----
  const overrides = events
    .filter((e) => e.action === 'grade_override')
    .map((e) => parseGradeOverride(e))
    .filter((o): o is GradeOverride => o !== null)

  const globalDeltas = overrides.map((o) => o.humanScore - o.machineScore)
  if (overrides.length >= minSamples) {
    const mean = avg(globalDeltas)
    const sameDirection = globalDeltas.filter((d) => Math.sign(d) === Math.sign(mean)).length / globalDeltas.length
    if (Math.abs(mean) >= minMeanShift && sameDirection >= 0.7) {
      proposals.push({
        kind: 'grading_bias',
        target: 'brain/grading.md',
        summary: `Graders systematically score ${mean > 0 ? 'lower' : 'higher'} than reviewers by ~${Math.abs(mean).toFixed(0)} points`,
        proposedChange:
          mean > 0
            ? `Posture is too strict relative to human judgment: review the floor rules and hard disqualifiers in grading.md — humans raised ${Math.round(sameDirection * 100)}% of overridden scores (mean +${mean.toFixed(1)}).`
            : `Posture is too generous relative to human judgment: tighten floor rules in grading.md — humans lowered ${Math.round(sameDirection * 100)}% of overridden scores (mean ${mean.toFixed(1)}).`,
        evidence: {
          eventIds: overrides.map((o) => o.event.id),
          sampleSize: overrides.length,
          detail: `mean shift ${mean.toFixed(1)}, ${Math.round(sameDirection * 100)}% same direction`,
        },
      })
    }
  }

  // per-segment bias (e.g. one industry consistently over/under-graded)
  const bySegment = groupBy(overrides.filter((o) => o.segment !== null), (o) => o.segment as string)
  for (const [segment, seg] of bySegment) {
    if (seg.length < minSamples) continue
    const deltas = seg.map((o) => o.humanScore - o.machineScore)
    const mean = avg(deltas)
    const sameDirection = deltas.filter((d) => Math.sign(d) === Math.sign(mean)).length / deltas.length
    if (Math.abs(mean) >= minMeanShift && sameDirection >= 0.7) {
      proposals.push({
        kind: 'grading_segment',
        target: 'brain/grading.md',
        summary: `"${segment}" accounts consistently ${mean > 0 ? 'under' : 'over'}-graded (mean shift ${mean.toFixed(1)}, n=${seg.length})`,
        proposedChange: `Add a ${segment}-specific rule to grading.md: reviewers moved ${segment} scores ${mean > 0 ? 'up' : 'down'} by ~${Math.abs(mean).toFixed(0)} points in ${seg.length} overrides — likely a missing ${mean > 0 ? 'floor rule' : 'disqualifier/edge case'} for this segment.`,
        evidence: {
          eventIds: seg.map((o) => o.event.id),
          sampleSize: seg.length,
          detail: `segment=${segment}, mean shift ${mean.toFixed(1)}`,
        },
      })
    }
  }

  // ---- routing corrections (the "$100M threshold" pattern) ----
  const corrections = events.filter((e) => e.action === 'routing_correction')
  const byPair = groupBy(corrections, (e) => {
    const from = stringField(e.machine.output, 'owner') ?? 'unknown'
    const to = stringField(e.humanOutput, 'owner') ?? 'unknown'
    return `${from} → ${to}`
  })
  for (const [pair, group] of byPair) {
    if (group.length < minSamples) continue
    proposals.push({
      kind: 'routing_rule',
      target: 'brain/routing.md',
      summary: `${group.length} routing overrides reassigning ${pair}`,
      proposedChange: `Review the rule that routed these to ${pair.split(' → ')[0]}: ${group.length} corrections moved them to ${pair.split(' → ')[1]}. If they cluster near a threshold (check the evidence rows), propose the threshold change in routing.md / learned/thresholds.yaml.`,
      evidence: {
        eventIds: group.map((e) => e.id),
        sampleSize: group.length,
        detail: `pair ${pair}`,
      },
    })
  }

  return proposals
}

/**
 * Guardrail wrapper: a proposal may only be surfaced if the relevant skill's
 * eval set still passes with the change hypothetically applied. v1 contract:
 * the caller supplies the eval runner; failures annotate rather than silently
 * drop (an eval-failing pattern is still information for the GTME).
 */
export async function gateProposals(
  proposals: TuningProposal[],
  evalGate: (proposal: TuningProposal) => Promise<{ pass: boolean; detail: string }>,
): Promise<(TuningProposal & { evalResult: { pass: boolean; detail: string } })[]> {
  const gated = []
  for (const proposal of proposals) {
    gated.push({ ...proposal, evalResult: await evalGate(proposal) })
  }
  return gated
}

export function renderTuningReport(clientName: string, date: string, proposals: TuningProposal[]): string {
  const lines = [
    `# Weekly Tuning Proposals — ${clientName} (${date})`,
    '',
    proposals.length === 0
      ? 'No override patterns crossed the proposal threshold this week.'
      : `${proposals.length} proposal(s). Each is a reviewable change — approve, adapt, or reject; nothing applies automatically.`,
    '',
  ]
  proposals.forEach((p, i) => {
    lines.push(
      `## ${i + 1}. ${p.summary}`,
      '',
      `**Target:** \`${p.target}\` · **evidence:** ${p.evidence.sampleSize} events (${p.evidence.detail})`,
      '',
      p.proposedChange,
      '',
    )
  })
  return lines.join('\n')
}

// ---- helpers ----

function parseGradeOverride(event: HumanActionEvent): GradeOverride | null {
  const machineScore = numberField(event.machine.output, 'score')
  const humanScore = numberField(event.humanOutput, 'score')
  if (machineScore === null || humanScore === null) return null
  const labels = (event.machine.output as { labels?: Record<string, string> } | null)?.labels
  return { event, machineScore, humanScore, segment: labels?.industry ?? null }
}

function numberField(obj: unknown, key: string): number | null {
  if (typeof obj !== 'object' || obj === null) return null
  const v = (obj as Record<string, unknown>)[key]
  return typeof v === 'number' ? v : null
}

function stringField(obj: unknown, key: string): string | null {
  if (typeof obj !== 'object' || obj === null) return null
  const v = (obj as Record<string, unknown>)[key]
  return typeof v === 'string' ? v : null
}

function avg(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const key = keyOf(item)
    const list = map.get(key)
    if (list) list.push(item)
    else map.set(key, [item])
  }
  return map
}
