// Hologram shadow-run: re-grade the human-graded connectivity list with the
// List Grader (live model), compare against the human A/B/C/D/X fits, write
// the shadow report. THE go/no-go validation artifact.
//
// Usage:
//   node tools/shadow-hologram/run.mjs             # all rows, live model
//   node tools/shadow-hologram/run.mjs --sample 20 # first N rows
//   node tools/shadow-hologram/run.mjs --fake      # plumbing check, no API
//
// Requires fixtures (node tools/shadow-hologram/build-fixtures.mjs) and, for
// live runs, SDK-resolvable credentials (ANTHROPIC_API_KEY or `ant auth login`).
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '../..')
const FIX = resolve(ROOT, 'shadow-runs/hologram')
const { listGrader, AnthropicLlmClient } = await import(`${ROOT}/packages/skills/dist/index.js`)
const { compareGrades, shadowReport, scoreToBand } = await import(`${ROOT}/packages/shadow/dist/index.js`)

const args = process.argv.slice(2)
const fake = args.includes('--fake')
const sampleIdx = args.indexOf('--sample')
const sample = sampleIdx >= 0 ? parseInt(args[sampleIdx + 1], 10) : null

const brainContext = await readFile(`${FIX}/brain-context.md`, 'utf8')
let rows = JSON.parse(await readFile(`${FIX}/rows.json`, 'utf8'))
const manual = JSON.parse(await readFile(`${FIX}/manual.json`, 'utf8'))
if (sample) rows = rows.slice(0, sample)

const config = {
  brainContext,
  vocabularies: {
    industry: ['Agriculture', 'Construction', 'Energy & Utilities', 'Entertainment & Events', 'Fleet & Logistics', 'Healthcare', 'Manufacturing', 'Retail & Hospitality', 'Security & Surveillance', 'Smart Buildings', 'Smart Cities & Government', 'Other'],
    use_case: ['AI/Edge/Video', 'Telemetry & Monitoring', 'Asset Tracking & Fleet', 'Transaction & Control', 'Robotics & Autonomous', 'Micromobility', 'EV Charging', 'Drones/UAV', 'Remote Patient Monitoring'],
  },
  reviewerRules: [
    'Hologram COMPETITORS (IoT MVNOs: KORE, Soracom, Telnyx, 1NCE, EMnify, Eseye, Onomondo, Monogoto, Simbase, Things Mobile, SIMON IoT, Wireless Logic, Simetry, Cubic Telecom, Deutsche Telekom IoT, T-Systems IoT) and telecom carriers MUST score 1-20',
    'Software-only companies (no device) MUST score below 30',
    'Consumer trackers under $5 ARPU MUST score below 25',
    'Confirmed cellular connectivity + relevant industry MUST score 66 or higher, even if other signals are weak',
    'Enterprise size alone is NOT a disqualifier',
  ],
  batchSize: 20,
  maxRetries: 3,
  minReviewerScore: 75,
}

const llm = fake
  ? { complete: async ({ user }) => fakeResponse(user) }
  : new AnthropicLlmClient('claude-opus-4-8')

console.log(`grading ${rows.length} rows (${fake ? 'FAKE' : 'live claude-opus-4-8'})...`)
const started = Date.now()
const result = await listGrader.gradeList(rows, config, llm, (done, total) =>
  console.log(`  batch ${done}/${total} (${Math.round((Date.now() - started) / 1000)}s)`),
)
console.log(`graded ${result.grades.length}, ungraded ${result.ungraded.length}, unaccepted batches ${result.journal.filter((j) => !j.accepted).length}`)

const comparison = compareGrades(
  result.grades.map((g) => ({ id: g.id, score: g.score, labels: g.labels })),
  manual.filter((m) => rows.some((r) => r.id === m.id)),
)
const report = shadowReport({
  engagement: `Hologram connectivity list (${rows.length} accounts, ${fake ? 'FAKE PLUMBING RUN' : 'live'})`,
  date: new Date().toISOString().slice(0, 10),
  grades: { comparison },
})

await writeFile(`${FIX}/machine-grades.json`, JSON.stringify(result, null, 2))
await writeFile(`${FIX}/report.md`, report)
console.log('\n' + report)
console.log(`\nwritten: shadow-runs/hologram/report.md + machine-grades.json`)

// --fake: deterministic plausible responses so the plumbing is verifiable without credentials
function fakeResponse(user) {
  if (user.includes('GRADES TO AUDIT')) return JSON.stringify({ batch_score: 90, issues: [], summary: 'fake pass' })
  const ids = [...user.matchAll(/--- id: (\S+) ---/g)].map((m) => m[1])
  return JSON.stringify(
    ids.map((id) => ({
      id,
      score: 70,
      labels: { industry: 'Healthcare', use_case: 'Remote Patient Monitoring' },
      reasoning: 'fake',
    })),
  )
}
