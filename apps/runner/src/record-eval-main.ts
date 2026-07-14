import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { EvaluationRun } from '@sartre/operations'
import { createPostgresConnection, migrate, PostgresEvaluationRunStore } from '@sartre/db'
import { loadRunnerConfig } from './config.js'

const [clientId, skillId, version, passedText, failedText, source = 'live', ...detailParts] = process.argv.slice(2)
if (!clientId || !skillId || !version || passedText === undefined || failedText === undefined) {
  throw new Error('usage: npm run record-eval -- <client> <skill> <version> <passed> <failed> [ci|live|learning] [detail]')
}
const passed = Number(passedText); const failed = Number(failedText)
const evaluation = EvaluationRun.parse({
  evaluationId: randomUUID(), clientId, skillId, version, passed, failed,
  status: failed === 0 ? 'passed' : 'failed', source, detail: detailParts.join(' '), createdAt: new Date().toISOString(),
})
const config = loadRunnerConfig(process.env, resolve(import.meta.dirname, '../../..'))
const connection = createPostgresConnection(config.databaseUrl)
try {
  await migrate(connection)
  await new PostgresEvaluationRunStore(connection).append(evaluation)
  console.log(JSON.stringify({ status: 'ok', evaluationId: evaluation.evaluationId, result: evaluation.status }))
} finally {
  await connection.close()
}
