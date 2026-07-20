import { mkdir, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createPostgresConnection, migrate, PostgresRunStore } from '@sartre/db'
import { DEMO_CLIENT_ID, seedDemoRuns } from './seed-demo.js'

/**
 * Local click-through seeding CLI. Writes an active demo client manifest into
 * SARTRE_CLIENTS_DIR and parks four awaiting-approval runs (ABM, takeout, event
 * follow-up, TAM) in Postgres so the ops review queue has something to render.
 *
 *   DATABASE_URL=postgres://... SARTRE_CLIENTS_DIR=.sartre-demo \
 *     npm run seed-demo --workspace @sartre/runner
 *
 * See docs/local-dev.md for the full click-through walkthrough.
 */
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required to seed the demo tenant')

const clientsDir = resolve(process.env.SARTRE_CLIENTS_DIR ?? '.sartre-demo')
const templatePath = resolve(import.meta.dirname, '../../../clients/_template/client.yaml')

/** Turn the reviewed template into an active demo manifest via anchored, unique replacements. */
function demoManifestYaml(): string {
  let yaml = readFileSync(templatePath, 'utf8')
  yaml = yaml.replace('status: onboarding', 'status: active')
  for (const moduleId of ['sales.abm', 'sales.takeout', 'marketing.events', 'revops.tam']) {
    const before = `  ${moduleId}:\n    enabled: false`
    const after = `  ${moduleId}:\n    enabled: true`
    if (!yaml.includes(before)) throw new Error(`template is missing the ${moduleId} module block`)
    yaml = yaml.replace(before, after)
  }
  return yaml
}

const connection = createPostgresConnection(databaseUrl)
try {
  await migrate(connection)
  const clientDir = resolve(clientsDir, DEMO_CLIENT_ID)
  await mkdir(clientDir, { recursive: true })
  await writeFile(resolve(clientDir, 'client.yaml'), demoManifestYaml(), 'utf8')
  const seeded = await seedDemoRuns(new PostgresRunStore(connection))
  console.log(`Seeded demo tenant "${DEMO_CLIENT_ID}" into ${clientsDir}`)
  for (const run of seeded) console.log(`  ${run.moduleId}: run ${run.runId} → ${run.status}`)
  console.log('\nNext: point SARTRE_CLIENTS_DIR at this dir, start the ops app, and open the review queue.')
  console.log('See docs/local-dev.md for the full walkthrough.')
} finally {
  await connection.close()
}
