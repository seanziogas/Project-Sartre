'use client'

import { useState } from 'react'

interface ProviderOption {
  id: string
  label: string
  category: string
  auth: readonly string[]
  requiredCredentials: readonly string[]
  optionalCredentials?: readonly string[]
  detail: string
}

const labels: Record<string, string> = {
  accessToken: 'Access token', apiKey: 'API key', instanceUrl: 'CRM/tenant instance URL', convertedLeadStatus: 'Salesforce converted-lead status',
  apiDomain: 'Zoho API domain', accountsUrl: 'Zoho Accounts URL', enrichmentUrl: 'Clay enrichment URL', healthcheckUrl: 'Clay healthcheck URL',
  clientId: 'OAuth client ID', clientSecret: 'OAuth client secret', refreshToken: 'OAuth refresh token', tenant: 'Microsoft tenant',
  baseUrl: 'Provider API/base URL', accountUrl: 'Snowflake account URL', token: 'Warehouse token', projectId: 'BigQuery project ID',
  customerId: 'Google Ads customer ID', adAccountId: 'Meta ad-account ID', mailboxId: 'Outreach mailbox ID', enrollmentUrl: 'Enrollment URL',
  signalsUrl: 'Intent signals URL', leadsUrl: 'Inbound leads URL', accessKey: 'Gong access key', accessKeySecret: 'Gong access-key secret',
  location: 'Warehouse location', warehouse: 'Warehouse name', database: 'Database', schema: 'Schema', role: 'Role', lookbackDays: 'Transcript lookback days',
  apiVersion: 'API version', workspaceUrl: 'Databricks workspace URL', warehouseId: 'Databricks warehouse ID', region: 'AWS region',
  accessKeyId: 'AWS access-key ID', secretAccessKey: 'AWS secret access key', sessionToken: 'AWS session token', clusterIdentifier: 'Redshift cluster ID',
  workgroupName: 'Redshift workgroup', secretArn: 'Redshift secret ARN', dbUser: 'Redshift database user', listId: 'Marketo list ID',
}

const secretField = /token|secret|key|clientId/i
const urlField = /url$|domain$/i

export function ProviderConnectionForm({ providers, action }: {
  providers: readonly ProviderOption[]
  action: (formData: FormData) => void | Promise<void>
}) {
  const [providerId, setProviderId] = useState(providers[0]?.id ?? '')
  const [authKind, setAuthKind] = useState(providers[0]?.auth[0] ?? '')
  const provider = providers.find((candidate) => candidate.id === providerId)
  if (!provider) return null
  const fields = [...new Set([...provider.requiredCredentials, ...(provider.optionalCredentials ?? [])])]
  const required = new Set(provider.requiredCredentials)
  if (provider.id === 'fathom' && authKind === 'api_key') {
    required.delete('accessToken')
    required.add('apiKey')
  }
  if (provider.id === 'gong') required.add(authKind === 'oauth' ? 'accessToken' : 'accessKey')
  if (provider.id === 'gong' && authKind === 'api_key') required.add('accessKeySecret')
  if (provider.id === 'marketo') {
    required.add(authKind === 'service_account' ? 'clientId' : 'accessToken')
    if (authKind === 'service_account') required.add('clientSecret')
  }

  return (
    <form action={action} className="card connection-form">
      <label>Provider<select name="provider" value={providerId} onChange={(event) => {
        const next = providers.find((candidate) => candidate.id === event.target.value)
        setProviderId(event.target.value)
        setAuthKind(next?.auth[0] ?? '')
      }}>
        {(['crm', 'enrichment', 'comms', 'meetings', 'sequencer', 'ads', 'warehouse', 'intent', 'inbound'] as const).map((category) => (
          <optgroup key={category} label={category}>{providers.filter((candidate) => candidate.category === category).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}</optgroup>
        ))}
      </select></label>
      <label>Connection label<input type="text" name="label" required placeholder={`${provider.label} connection`} /></label>
      <label>Authentication<select name="authKind" value={authKind} onChange={(event) => setAuthKind(event.target.value)}>
        {provider.auth.map((auth) => <option key={auth} value={auth}>{auth.replace('_', ' ')}</option>)}
      </select></label>
      <div className="full muted">{provider.detail}</div>
      {fields.map((field) => <label key={`${provider.id}:${field}`}>{labels[field] ?? field}{required.has(field) ? ' *' : ''}
        <input type={secretField.test(field) ? 'password' : urlField.test(field) ? 'url' : field === 'lookbackDays' ? 'number' : 'text'} name={field} required={required.has(field)} autoComplete="off" />
      </label>)}
      <label>Custom credential name<input type="text" name="customCredentialName" placeholder="providerField" /></label>
      <label>Custom credential value<input type="password" name="customCredentialValue" autoComplete="off" /></label>
      <div className="full">
        <button type="submit" className="approve">Save encrypted connection</button>
        <span className="muted"> Credentials are write-only and are never displayed after submission.</span>
      </div>
    </form>
  )
}
