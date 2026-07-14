import { resolve } from 'node:path'
import { decideGovernanceRequest } from '@sartre/operations'
import { createPostgresConnection, migrate, PostgresGovernanceStore } from '@sartre/db'
import { loadRunnerConfig } from './config.js'

const [clientId, requestId, decision, actor] = process.argv.slice(2)
if (!clientId || !requestId || !actor || (decision !== 'approved' && decision !== 'rejected')) {
  throw new Error('usage: npm run governance-decide -- <client> <request-id> <approved|rejected> <actor>')
}
const config = loadRunnerConfig(process.env, resolve(import.meta.dirname, '../../..'))
const connection = createPostgresConnection(config.databaseUrl)
try {
  await migrate(connection)
  const store = new PostgresGovernanceStore(connection)
  const request = await store.getRequest(clientId, requestId)
  if (!request) throw new Error('governance request not found')
  const decided = decideGovernanceRequest(request, decision, actor, new Date().toISOString())
  await store.putRequest(decided)
  console.log(JSON.stringify({ status: decided.status, requestId }))
} finally { await connection.close() }
