import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { DataCategory, GovernanceRequest } from '@sartre/operations'
import { createPostgresConnection, migrate, PostgresGovernanceStore } from '@sartre/db'
import { loadRunnerConfig } from './config.js'

const [clientId, kind, actor, reason, ...scopeValues] = process.argv.slice(2)
if (!clientId || !kind || !actor || !reason) throw new Error('usage: npm run governance-request -- <client> <export|restore|retention|deletion> <actor> <reason> [categories...]')
const request = GovernanceRequest.parse({
  requestId: randomUUID(), clientId, kind, status: 'pending', scope: scopeValues.length ? scopeValues.map((item) => DataCategory.parse(item)) : DataCategory.options,
  reason, requestedBy: actor, requestedAt: new Date().toISOString(), decidedBy: null, decidedAt: null, executedBy: null, executedAt: null,
})
const config = loadRunnerConfig(process.env, resolve(import.meta.dirname, '../../..'))
const connection = createPostgresConnection(config.databaseUrl)
try {
  await migrate(connection); await new PostgresGovernanceStore(connection).putRequest(request)
  console.log(JSON.stringify({ status: 'pending', requestId: request.requestId, clientId, kind }))
} finally { await connection.close() }
