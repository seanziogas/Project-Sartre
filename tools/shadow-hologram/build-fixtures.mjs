// Build Hologram shadow-run fixtures from the READ-ONLY reference copy.
// One-way extraction: reads the reference folder, writes to shadow-runs/
// (gitignored — client data never enters the repo history).
//
// Usage: node tools/shadow-hologram/build-fixtures.mjs [path-to-hologram-reference]
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const REF = process.argv[2] ?? "/Users/sean/Documents/Internal Repo's/cxt_hub-main/clients/Hologram"
const OUT = resolve(import.meta.dirname, '../../shadow-runs/hologram')
await mkdir(OUT, { recursive: true })

// 1. Brain context — same surface the proven classifier loaded
const parts = []
const add = async (label, path) => {
  parts.push(`\n\n=== ${label} ===\n\n${await readFile(join(REF, path), 'utf8')}`)
}
await add('ICP', 'icp.md')
await add('GRADING RULEBOOK', '.claude-hologram/hologram-grading.md')
await add('USE-CASE FRAMEWORK', 'use-cases/_FRAMEWORK.md')
await add('INDUSTRY INDEX', 'industries/_INDEX.md')
await add('CLOSED-WON REFERENCE', 'customers/hologram_closed_won_customer_reference_1.md')
for (const f of (await readdir(join(REF, 'customers/case-studies'))).filter((f) => f.endsWith('.md'))) {
  await add(`CASE STUDY: ${f}`, `customers/case-studies/${f}`)
}
await writeFile(join(OUT, 'brain-context.md'), parts.join(''))

// 2. Rows + manual grades from the human-graded connectivity list
const csv = await readFile(join(REF, 'files/connectivity-list-icp-grading.csv'), 'utf8')
const records = parseCsv(csv)
const rows = []
const manual = []
for (const r of records) {
  const name = r['Company Name']?.trim()
  const grade = r['Fit']?.trim().toUpperCase()
  if (!name || !grade) continue
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  rows.push({
    id,
    fields: {
      name,
      website: r['Company Website']?.trim() || null,
      description: r['Company Description']?.trim() || null,
    },
  })
  manual.push({ id, grade })
}
await writeFile(join(OUT, 'rows.json'), JSON.stringify(rows, null, 2))
await writeFile(join(OUT, 'manual.json'), JSON.stringify(manual, null, 2))
console.log(`fixtures written to ${OUT}: ${rows.length} rows, brain context ${parts.join('').length} chars`)

// minimal RFC-4180 CSV parser (quoted fields, embedded newlines)
function parseCsv(text) {
  const rows = []
  let field = ''
  let record = []
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') inQuotes = false
      else field += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ',') { record.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      record.push(field); field = ''
      if (record.some((f) => f !== '')) rows.push(record)
      record = []
    } else field += ch
  }
  if (field !== '' || record.length > 0) { record.push(field); if (record.some((f) => f !== '')) rows.push(record) }
  const [header, ...data] = rows
  return data.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}
