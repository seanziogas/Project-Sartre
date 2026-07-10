// Post-run calibration analysis: beyond band agreement, is the machine's
// judgment RANK-ORDERED with the humans'? If mean machine score descends
// monotonically A → B → C → D → X, the judgment is sound and any band
// disagreement is a cutoff-calibration question, not a quality one.
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const FIX = resolve(import.meta.dirname, '../../shadow-runs/hologram')
const machine = JSON.parse(await readFile(`${FIX}/machine-grades.json`, 'utf8'))
const manual = JSON.parse(await readFile(`${FIX}/manual.json`, 'utf8'))

const manualById = new Map(manual.map((m) => [m.id, m.grade]))
const byGrade = new Map()
for (const g of machine.grades) {
  const human = manualById.get(g.id)
  if (!human) continue
  const list = byGrade.get(human) ?? []
  list.push(g.score)
  byGrade.set(human, list)
}

console.log('## Calibration: machine score distribution per HUMAN grade\n')
console.log('| human grade | n | machine mean | machine median | min-max |')
console.log('|---|---|---|---|---|')
const order = ['A', 'B', 'C', 'D', 'X']
const means = []
for (const grade of order) {
  const scores = (byGrade.get(grade) ?? []).sort((a, b) => a - b)
  if (scores.length === 0) continue
  const mean = scores.reduce((s, x) => s + x, 0) / scores.length
  means.push({ grade, mean })
  const median = scores[Math.floor(scores.length / 2)]
  console.log(`| ${grade} | ${scores.length} | ${mean.toFixed(1)} | ${median} | ${scores[0]}-${scores[scores.length - 1]} |`)
}

const monotonic = means.every((m, i) => i === 0 || m.mean < means[i - 1].mean)
console.log(`\nRank ordering: ${monotonic ? '✅ MONOTONIC — machine judgment ranks accounts the same way humans do; disagreements are cutoff calibration' : '⚠️ NON-MONOTONIC — at least one grade pair is inverted; review those rows'}`)

// where would the cutoffs need to sit to maximize exact agreement?
const pairs = machine.grades
  .filter((g) => manualById.has(g.id))
  .map((g) => ({ score: g.score, human: manualById.get(g.id) }))
const gradeRank = { A: 4, B: 3, C: 2, D: 1, X: 0 }
let bestAB = null
for (let cut = 60; cut <= 95; cut++) {
  const correct = pairs.filter((p) => (p.score >= cut ? 'A' : 'notA') === (p.human === 'A' ? 'A' : 'notA')).length
  if (!bestAB || correct > bestAB.correct) bestAB = { cut, correct }
}
console.log(`\nBest A-boundary for THIS team's grading style: score ≥ ${bestAB.cut} (${bestAB.correct}/${pairs.length} correct A/not-A) vs the codified 81`)

// Spearman-ish: mean human rank per machine band ordering check
const inversionRows = pairs.filter((p) => {
  const bandRank = p.score >= 81 ? 4 : p.score >= 66 ? 3 : p.score >= 41 ? 2 : p.score >= 21 ? 1 : 0
  return Math.abs(bandRank - gradeRank[p.human]) >= 2
})
console.log(`Rows two+ bands apart (the real disagreements to review): ${inversionRows.length}/${pairs.length}`)
