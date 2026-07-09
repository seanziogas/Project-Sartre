import { levenshtein } from '@sartre/data'

/**
 * Shadow-run harness (Phase 2 validation). Runs compare Sartre's outputs
 * against the manual motion's outputs on the SAME inputs — validation without
 * a pilot-client dependency. Feed it JSON exports of what the team produced
 * by hand; the report is the go/no-go artifact.
 */

// ---------- grades ----------

export interface MachineGrade {
  id: string
  score: number // 1-100
  labels: Record<string, string>
}

export interface ManualGrade {
  id: string
  /** Either a numeric score or a letter grade — manual data is messy. */
  score?: number
  grade?: string
  labels?: Record<string, string>
}

/** Default band mapping (the proven Hologram bands). Override per client. */
export const DEFAULT_BANDS: { grade: string; min: number; max: number }[] = [
  { grade: 'A', min: 81, max: 100 },
  { grade: 'B', min: 66, max: 80 },
  { grade: 'C', min: 41, max: 65 },
  { grade: 'D', min: 21, max: 40 },
  { grade: 'X', min: 1, max: 20 },
]

export function scoreToBand(score: number, bands = DEFAULT_BANDS): string {
  return bands.find((b) => score >= b.min && score <= b.max)?.grade ?? '?'
}

export interface GradeComparison {
  compared: number
  onlyMachine: string[]
  onlyManual: string[]
  bandAgreement: number // 0..1 — exact band match
  adjacentAgreement: number // 0..1 — within one band
  meanAbsScoreDelta: number | null // only where both sides have numeric scores
  labelAgreement: Record<string, number>
  disagreements: { id: string; machineBand: string; manualBand: string; scoreDelta: number | null }[]
}

export function compareGrades(
  machine: MachineGrade[],
  manual: ManualGrade[],
  bands = DEFAULT_BANDS,
): GradeComparison {
  const manualById = new Map(manual.map((m) => [m.id, m]))
  const machineIds = new Set(machine.map((m) => m.id))
  const bandOrder = bands.map((b) => b.grade)

  let bandMatches = 0
  let adjacent = 0
  const scoreDeltas: number[] = []
  const labelTotals: Record<string, { match: number; total: number }> = {}
  const disagreements: GradeComparison['disagreements'] = []
  let compared = 0

  for (const mg of machine) {
    const manualGrade = manualById.get(mg.id)
    if (!manualGrade) continue
    compared++

    const machineBand = scoreToBand(mg.score, bands)
    const manualBand =
      manualGrade.grade?.toUpperCase() ?? (manualGrade.score !== undefined ? scoreToBand(manualGrade.score, bands) : '?')
    const scoreDelta = manualGrade.score !== undefined ? Math.abs(mg.score - manualGrade.score) : null
    if (scoreDelta !== null) scoreDeltas.push(scoreDelta)

    if (machineBand === manualBand) {
      bandMatches++
      adjacent++
    } else {
      const dist = Math.abs(bandOrder.indexOf(machineBand) - bandOrder.indexOf(manualBand))
      if (dist === 1) adjacent++
      disagreements.push({ id: mg.id, machineBand, manualBand, scoreDelta })
    }

    if (manualGrade.labels) {
      for (const [field, manualValue] of Object.entries(manualGrade.labels)) {
        labelTotals[field] ??= { match: 0, total: 0 }
        labelTotals[field].total++
        if (normalizeLabel(mg.labels[field]) === normalizeLabel(manualValue)) labelTotals[field].match++
      }
    }
  }

  disagreements.sort((a, b) => (b.scoreDelta ?? 0) - (a.scoreDelta ?? 0))
  return {
    compared,
    onlyMachine: machine.filter((m) => !manualById.has(m.id)).map((m) => m.id),
    onlyManual: manual.filter((m) => !machineIds.has(m.id)).map((m) => m.id),
    bandAgreement: compared === 0 ? 0 : bandMatches / compared,
    adjacentAgreement: compared === 0 ? 0 : adjacent / compared,
    meanAbsScoreDelta:
      scoreDeltas.length === 0 ? null : scoreDeltas.reduce((s, d) => s + d, 0) / scoreDeltas.length,
    labelAgreement: Object.fromEntries(
      Object.entries(labelTotals).map(([f, t]) => [f, t.total === 0 ? 0 : t.match / t.total]),
    ),
    disagreements,
  }
}

function normalizeLabel(v: string | undefined): string {
  return (v ?? '').trim().toLowerCase()
}

// ---------- routing ----------

export interface RoutingComparison {
  compared: number
  agreement: number
  mismatches: { id: string; machineOwner: string; manualOwner: string }[]
}

export function compareRouting(
  machine: { id: string; owner: string }[],
  manual: { id: string; owner: string }[],
): RoutingComparison {
  const manualById = new Map(manual.map((m) => [m.id, m.owner]))
  let matches = 0
  let compared = 0
  const mismatches: RoutingComparison['mismatches'] = []
  for (const m of machine) {
    const manualOwner = manualById.get(m.id)
    if (manualOwner === undefined) continue
    compared++
    if (normalizeLabel(m.owner) === normalizeLabel(manualOwner)) matches++
    else mismatches.push({ id: m.id, machineOwner: m.owner, manualOwner })
  }
  return { compared, agreement: compared === 0 ? 0 : matches / compared, mismatches }
}

// ---------- campaign copy ----------

export interface CopyComparison {
  compared: number
  meanSubjectSimilarity: number
  meanBodySimilarity: number
  /** Machine emails still containing unfilled {slot} placeholders — hard fails. */
  unfilledSlotIds: string[]
  lowestSimilarity: { id: string; bodySimilarity: number }[]
}

export function compareCopy(
  machine: { id: string; subject: string; body: string }[],
  manual: { id: string; subject: string; body: string }[],
): CopyComparison {
  const manualById = new Map(manual.map((m) => [m.id, m]))
  const perRow: { id: string; subj: number; body: number }[] = []
  const unfilled: string[] = []

  for (const m of machine) {
    if (/\{[a-z0-9_]+\}/i.test(m.body.replace(/\{\{[^}]+\}\}/g, ''))) unfilled.push(m.id)
    const manualRow = manualById.get(m.id)
    if (!manualRow) continue
    perRow.push({
      id: m.id,
      subj: similarity(m.subject, manualRow.subject),
      body: similarity(m.body, manualRow.body),
    })
  }

  const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length)
  return {
    compared: perRow.length,
    meanSubjectSimilarity: mean(perRow.map((r) => r.subj)),
    meanBodySimilarity: mean(perRow.map((r) => r.body)),
    unfilledSlotIds: unfilled,
    lowestSimilarity: [...perRow]
      .sort((a, b) => a.body - b.body)
      .slice(0, 10)
      .map((r) => ({ id: r.id, bodySimilarity: r.body })),
  }
}

function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length)
  return maxLen === 0 ? 1 : 1 - levenshtein(a.toLowerCase(), b.toLowerCase()) / maxLen
}

// ---------- report ----------

export interface ShadowRunInput {
  engagement: string
  date: string
  grades?: { comparison: GradeComparison }
  routing?: { comparison: RoutingComparison }
  copy?: { comparison: CopyComparison }
}

const pct = (n: number) => `${Math.round(n * 100)}%`

export function shadowReport(input: ShadowRunInput): string {
  const lines: string[] = [
    `# Shadow-Run Report — ${input.engagement}`,
    '',
    `Date: ${input.date}. Sartre ran on the same inputs as the manual motion; this compares the outputs.`,
    '',
  ]
  if (input.grades) {
    const g = input.grades.comparison
    lines.push(
      '## Grading',
      '',
      `- Compared: **${g.compared}** accounts (${g.onlyMachine.length} machine-only, ${g.onlyManual.length} manual-only)`,
      `- Band agreement: **${pct(g.bandAgreement)}** exact, **${pct(g.adjacentAgreement)}** within one band`,
      g.meanAbsScoreDelta !== null ? `- Mean absolute score delta: **${g.meanAbsScoreDelta.toFixed(1)}** points` : '',
      ...Object.entries(g.labelAgreement).map(([f, a]) => `- Label agreement (${f}): **${pct(a)}**`),
      '',
    )
    if (g.disagreements.length > 0) {
      lines.push('### Top disagreements (review these with the GTME)', '')
      lines.push('| id | machine | manual | Δ score |', '|---|---|---|---|')
      for (const d of g.disagreements.slice(0, 15)) {
        lines.push(`| ${d.id} | ${d.machineBand} | ${d.manualBand} | ${d.scoreDelta ?? '—'} |`)
      }
      lines.push('')
    }
  }
  if (input.routing) {
    const r = input.routing.comparison
    lines.push('## Routing', '', `- Compared: **${r.compared}** · agreement: **${pct(r.agreement)}**`, '')
    if (r.mismatches.length > 0) {
      lines.push('| id | machine → | manual → |', '|---|---|---|')
      for (const m of r.mismatches.slice(0, 15)) lines.push(`| ${m.id} | ${m.machineOwner} | ${m.manualOwner} |`)
      lines.push('')
    }
  }
  if (input.copy) {
    const c = input.copy.comparison
    lines.push(
      '## Campaign copy',
      '',
      `- Compared: **${c.compared}** rows`,
      `- Mean similarity: subject **${pct(c.meanSubjectSimilarity)}**, body **${pct(c.meanBodySimilarity)}**`,
      c.unfilledSlotIds.length > 0
        ? `- ⚠️ **${c.unfilledSlotIds.length} emails with unfilled slots**: ${c.unfilledSlotIds.join(', ')}`
        : '- No unfilled slots.',
      '',
      'Copy similarity is context, not a target — machine copy should be judged in the review queue, not by edit distance alone.',
      '',
    )
  }
  return lines.filter((l) => l !== undefined).join('\n')
}
