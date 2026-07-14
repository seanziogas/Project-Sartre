// Hologram shadow-run: re-grade the human-graded connectivity list with the
// List Grader (live model), compare against the human A/B/C/D/X fits, write
// the shadow report. THE go/no-go validation artifact.
//
// Usage:
//   node tools/shadow-hologram/run.mjs --cli       # live via Claude Code CLI (subscription auth, no API key)
//   node tools/shadow-hologram/run.mjs             # live via Anthropic SDK (needs ANTHROPIC_API_KEY / ant profile)
//   node tools/shadow-hologram/run.mjs --sample 20 # first N rows
//   node tools/shadow-hologram/run.mjs --fake      # plumbing check, no model
//
// --cli is the proven Hologram pattern (classify_accounts.py): shell out to
// `claude -p` — Claude Code subscription auth, no API key required.
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '../..')
const FIX = resolve(ROOT, 'shadow-runs/hologram')
const { listGrader, AnthropicLlmClient } = await import(`${ROOT}/packages/skills/dist/index.js`)
const { compareGrades, shadowReport, scoreToBand } = await import(`${ROOT}/packages/shadow/dist/index.js`)

const args = process.argv.slice(2)
const fake = args.includes('--fake')
const useCli = args.includes('--cli')
const sampleIdx = args.indexOf('--sample')
const sample = sampleIdx >= 0 ? parseInt(args[sampleIdx + 1], 10) : null

const fixtures = await loadFixtures()
const brainContext = fixtures.brainContext
let rows = fixtures.rows
const manual = fixtures.manual
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
  : useCli
    ? await makeCliClient('claude-opus-4-8')
    : new AnthropicLlmClient('claude-opus-4-8')

console.log(`grading ${rows.length} rows (${fake ? 'FAKE' : useCli ? 'live via Claude Code CLI' : 'live via SDK'}, claude-opus-4-8)...`)
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

async function loadFixtures() {
  try {
    return {
      brainContext: await readFile(`${FIX}/brain-context.md`, 'utf8'),
      rows: JSON.parse(await readFile(`${FIX}/rows.json`, 'utf8')),
      manual: JSON.parse(await readFile(`${FIX}/manual.json`, 'utf8')),
    }
  } catch (error) {
    if (!fake || error?.code !== 'ENOENT') throw error
    await mkdir(FIX, { recursive: true })
    console.log('fixtures absent; using synthetic non-client fixtures for fake plumbing validation')
    return {
      brainContext: 'Synthetic validation brain: connected device makers are in-market; software-only vendors are not.',
      rows: [
        { id: 'connected-health-device', fields: { name: 'Connected Health Device', description: 'Cellular remote patient monitoring hardware' } },
        { id: 'fleet-tracker', fields: { name: 'Fleet Tracker', description: 'Cellular fleet telemetry devices' } },
        { id: 'software-only', fields: { name: 'Software Only', description: 'Analytics software with no physical device' } },
      ],
      manual: [
        { id: 'connected-health-device', grade: 'A' },
        { id: 'fleet-tracker', grade: 'B' },
        { id: 'software-only', grade: 'X' },
      ],
    }
  }
}

// Claude Code CLI client — subscription auth, no API key. System prompt via
// temp file (93KB exceeds comfortable argv), user payload via stdin.
async function makeCliClient(model) {
  const dir = await mkdtemp(join(tmpdir(), 'shadow-'))
  const systemFiles = new Map()
  let n = 0
  return {
    complete: async ({ system, user }) => {
      let file = systemFiles.get(system)
      if (!file) {
        file = join(dir, `system-${systemFiles.size}.md`)
        await writeFile(file, system)
        systemFiles.set(system, file)
      }
      n++
      const started = Date.now()
      const out = await new Promise((resolvePromise, reject) => {
        const child = spawn(
          'claude',
          ['-p', '--model', model, '--system-prompt-file', file, '--exclude-dynamic-system-prompt-sections'],
          { stdio: ['pipe', 'pipe', 'pipe'] },
        )
        let stdout = ''
        let stderr = ''
        const timer = setTimeout(() => { child.kill(); reject(new Error('CLI call timed out after 10 min')) }, 600_000)
        child.stdout.on('data', (d) => (stdout += d))
        child.stderr.on('data', (d) => (stderr += d))
        child.on('close', (code) => {
          clearTimeout(timer)
          if (code === 0) resolvePromise(stdout)
          else reject(new Error(`claude CLI exited ${code}: ${stderr.slice(0, 300)}`))
        })
        child.stdin.write(user)
        child.stdin.end()
      })
      console.log(`    cli call ${n} done (${Math.round((Date.now() - started) / 1000)}s)`)
      return out
    },
  }
}

// --fake: deterministic plausible responses so the plumbing is verifiable without credentials
function fakeResponse(user) {
  if (user.includes('GRADES TO AUDIT')) return JSON.stringify({ batch_score: 90, issues: [], summary: 'fake pass' })
  const ids = [...user.matchAll(/--- id: (\S+) ---/g)].map((m) => m[1])
  return JSON.stringify(
    ids.map((id) => ({
      id,
      score: id.includes('software-only') ? 15 : id.includes('connected-health') ? 90 : 70,
      labels: { industry: 'Healthcare', use_case: 'Remote Patient Monitoring' },
      reasoning: 'fake',
    })),
  )
}
