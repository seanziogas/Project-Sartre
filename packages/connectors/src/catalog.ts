export type ProviderCategory = 'crm' | 'enrichment' | 'comms' | 'meetings' | 'sequencer' | 'ads' | 'warehouse' | 'intent' | 'inbound'

export interface ProviderDefinition {
  id: string
  label: string
  category: ProviderCategory
  auth: readonly ('api_key' | 'oauth' | 'service_account')[]
  requiredCredentials: readonly string[]
  optionalCredentials?: readonly string[]
  detail: string
}

export const PROVIDER_CATALOG = [
  { id: 'salesforce', label: 'Salesforce', category: 'crm', auth: ['oauth'], requiredCredentials: ['accessToken', 'instanceUrl'], optionalCredentials: ['clientId', 'clientSecret', 'refreshToken', 'apiVersion', 'convertedLeadStatus'], detail: 'CRM reads, lead conversion, and snapshot-backed namespaced writes.' },
  { id: 'hubspot', label: 'HubSpot', category: 'crm', auth: ['oauth'], requiredCredentials: ['accessToken'], optionalCredentials: ['clientId', 'clientSecret', 'refreshToken'], detail: 'CRM reads and snapshot-backed namespaced writes.' },
  { id: 'attio', label: 'Attio', category: 'crm', auth: ['api_key', 'oauth'], requiredCredentials: ['accessToken'], optionalCredentials: ['clientId', 'clientSecret', 'refreshToken'], detail: 'CRM reads and snapshot-backed namespaced writes.' },
  { id: 'pipedrive', label: 'Pipedrive', category: 'crm', auth: ['oauth'], requiredCredentials: ['accessToken'], optionalCredentials: ['clientId', 'clientSecret', 'refreshToken'], detail: 'Organization, person, deal, activity, and lead reads.' },
  { id: 'dynamics', label: 'Dynamics 365 Sales', category: 'crm', auth: ['oauth'], requiredCredentials: ['accessToken', 'instanceUrl'], optionalCredentials: ['clientId', 'clientSecret', 'refreshToken', 'tenant', 'apiVersion'], detail: 'Dataverse account, contact, opportunity, activity, and lead reads.' },
  { id: 'zoho-crm', label: 'Zoho CRM', category: 'crm', auth: ['oauth'], requiredCredentials: ['accessToken', 'apiDomain'], optionalCredentials: ['clientId', 'clientSecret', 'refreshToken', 'accountsUrl'], detail: 'Zoho CRM V8 record reads with page tokens.' },
  { id: 'clay', label: 'Clay', category: 'enrichment', auth: ['api_key'], requiredCredentials: ['apiKey', 'enrichmentUrl'], optionalCredentials: ['healthcheckUrl'], detail: 'Client-owned enrichment webhook.' },
  { id: 'slack', label: 'Slack', category: 'comms', auth: ['oauth'], requiredCredentials: ['accessToken'], optionalCredentials: ['clientId', 'clientSecret', 'refreshToken'], detail: 'Approved Slack message delivery.' },
  { id: 'teams', label: 'Microsoft Teams', category: 'comms', auth: ['oauth'], requiredCredentials: ['accessToken'], optionalCredentials: ['clientId', 'clientSecret', 'refreshToken', 'tenant'], detail: 'Approved Teams channel delivery.' },
  { id: 'gmail', label: 'Gmail', category: 'comms', auth: ['oauth'], requiredCredentials: ['accessToken'], optionalCredentials: ['clientId', 'clientSecret', 'refreshToken'], detail: 'Approved email delivery through Gmail API.' },
  { id: 'microsoft-email', label: 'Microsoft Email', category: 'comms', auth: ['oauth'], requiredCredentials: ['accessToken'], optionalCredentials: ['clientId', 'clientSecret', 'refreshToken', 'tenant'], detail: 'Approved email delivery through Microsoft Graph.' },
  { id: 'fathom', label: 'Fathom', category: 'meetings', auth: ['api_key', 'oauth'], requiredCredentials: ['accessToken'], optionalCredentials: ['apiKey', 'clientId', 'clientSecret', 'refreshToken'], detail: 'Meeting and transcript reads.' },
  { id: 'gong', label: 'Gong', category: 'meetings', auth: ['api_key', 'oauth'], requiredCredentials: ['baseUrl'], optionalCredentials: ['accessToken', 'accessKey', 'accessKeySecret', 'clientId', 'clientSecret', 'refreshToken', 'lookbackDays'], detail: 'Call transcript reads from the tenant Gong API host.' },
  { id: 'fireflies', label: 'Fireflies.ai', category: 'meetings', auth: ['api_key'], requiredCredentials: ['apiKey'], detail: 'GraphQL transcript reads.' },
  { id: 'zoom', label: 'Zoom', category: 'meetings', auth: ['oauth'], requiredCredentials: ['accessToken'], optionalCredentials: ['clientId', 'clientSecret', 'refreshToken'], detail: 'Cloud recording transcript reads.' },
  { id: 'smartlead', label: 'Smartlead', category: 'sequencer', auth: ['api_key'], requiredCredentials: ['apiKey'], detail: 'Reviewed campaign enrollment.' },
  { id: 'instantly', label: 'Instantly', category: 'sequencer', auth: ['api_key'], requiredCredentials: ['apiKey'], detail: 'Reviewed campaign enrollment.' },
  { id: 'outreach', label: 'Outreach', category: 'sequencer', auth: ['oauth'], requiredCredentials: ['accessToken', 'mailboxId'], optionalCredentials: ['clientId', 'clientSecret', 'refreshToken'], detail: 'Reviewed sequence enrollment through a selected mailbox.' },
  { id: 'salesloft', label: 'Salesloft', category: 'sequencer', auth: ['oauth'], requiredCredentials: ['accessToken'], optionalCredentials: ['clientId', 'clientSecret', 'refreshToken'], detail: 'Reviewed cadence enrollment.' },
  { id: 'apollo', label: 'Apollo', category: 'sequencer', auth: ['api_key'], requiredCredentials: ['apiKey'], detail: 'Reviewed sequence enrollment.' },
  { id: 'heyreach', label: 'HeyReach', category: 'sequencer', auth: ['api_key'], requiredCredentials: ['apiKey', 'enrollmentUrl'], detail: 'Provider-host-constrained reviewed enrollment.' },
  { id: 'lemlist', label: 'lemlist', category: 'sequencer', auth: ['api_key'], requiredCredentials: ['apiKey', 'enrollmentUrl'], detail: 'Provider-host-constrained reviewed enrollment.' },
  { id: 'mailshake', label: 'Mailshake', category: 'sequencer', auth: ['api_key'], requiredCredentials: ['apiKey', 'enrollmentUrl'], detail: 'Provider-host-constrained reviewed enrollment.' },
  { id: 'linkedin-ads', label: 'LinkedIn Ads', category: 'ads', auth: ['oauth'], requiredCredentials: ['accessToken'], optionalCredentials: ['apiVersion'], detail: 'Reviewed Matched Audience synchronization.' },
  { id: 'google-ads', label: 'Google Ads', category: 'ads', auth: ['oauth'], requiredCredentials: ['accessToken', 'customerId'], optionalCredentials: ['clientId', 'clientSecret', 'refreshToken'], detail: 'Reviewed Customer Match synchronization through Data Manager API.' },
  { id: 'meta-ads', label: 'Meta Ads', category: 'ads', auth: ['oauth'], requiredCredentials: ['accessToken', 'adAccountId'], optionalCredentials: ['apiVersion'], detail: 'Reviewed Custom Audience synchronization.' },
  { id: 'snowflake', label: 'Snowflake', category: 'warehouse', auth: ['api_key', 'oauth'], requiredCredentials: ['accountUrl', 'token'], optionalCredentials: ['warehouse', 'database', 'schema', 'role'], detail: 'Parameterized SQL API execution.' },
  { id: 'bigquery', label: 'BigQuery', category: 'warehouse', auth: ['oauth'], requiredCredentials: ['projectId', 'accessToken'], optionalCredentials: ['location'], detail: 'Parameterized Standard SQL execution.' },
  { id: 'databricks', label: 'Databricks', category: 'warehouse', auth: ['api_key', 'oauth'], requiredCredentials: ['workspaceUrl', 'accessToken', 'warehouseId'], detail: 'SQL Statement API execution.' },
  { id: 'redshift', label: 'Amazon Redshift', category: 'warehouse', auth: ['service_account'], requiredCredentials: ['region', 'accessKeyId', 'secretAccessKey', 'database'], optionalCredentials: ['sessionToken', 'clusterIdentifier', 'workgroupName', 'secretArn', 'dbUser'], detail: 'SigV4-signed Redshift Data API execution.' },
  { id: 'sixsense', label: '6sense', category: 'intent', auth: ['api_key'], requiredCredentials: ['apiKey', 'signalsUrl'], detail: 'Provider-host-constrained intent staging.' },
  { id: 'g2', label: 'G2 Buyer Intent', category: 'intent', auth: ['api_key'], requiredCredentials: ['apiKey', 'signalsUrl'], detail: 'Provider-host-constrained intent staging.' },
  { id: 'clearbit', label: 'Clearbit', category: 'intent', auth: ['api_key'], requiredCredentials: ['apiKey', 'signalsUrl'], detail: 'Provider-host-constrained intent staging.' },
  { id: 'koala', label: 'Koala', category: 'intent', auth: ['api_key'], requiredCredentials: ['apiKey', 'signalsUrl'], detail: 'Provider-host-constrained intent staging.' },
  { id: 'bombora', label: 'Bombora', category: 'intent', auth: ['api_key'], requiredCredentials: ['apiKey', 'signalsUrl'], detail: 'Provider-host-constrained intent staging.' },
  { id: 'qualified', label: 'Qualified', category: 'inbound', auth: ['api_key'], requiredCredentials: ['accessToken', 'leadsUrl'], detail: 'Provider-host-constrained inbound staging with a tenant API token.' },
  { id: 'linkedin-leadgen', label: 'LinkedIn Lead Gen', category: 'inbound', auth: ['oauth'], requiredCredentials: ['accessToken', 'leadsUrl'], detail: 'Provider-host-constrained inbound staging.' },
  { id: 'typeform', label: 'Typeform', category: 'inbound', auth: ['oauth'], requiredCredentials: ['accessToken', 'leadsUrl'], detail: 'Form response staging.' },
  { id: 'chilipiper', label: 'Chili Piper', category: 'inbound', auth: ['api_key'], requiredCredentials: ['accessToken', 'leadsUrl'], detail: 'Provider-host-constrained inbound staging with a tenant API token.' },
  { id: 'marketo', label: 'Adobe Marketo Engage', category: 'inbound', auth: ['service_account', 'api_key'], requiredCredentials: ['instanceUrl', 'listId'], optionalCredentials: ['clientId', 'clientSecret', 'accessToken', 'expiresAt'], detail: 'Lead staging with Marketo two-legged OAuth or a short-lived access token.' },
] as const satisfies readonly ProviderDefinition[]

export type SupportedProvider = typeof PROVIDER_CATALOG[number]['id']
export const SUPPORTED_PROVIDERS = PROVIDER_CATALOG.map((provider) => provider.id) as SupportedProvider[]

export function isSupportedProvider(value: string): value is SupportedProvider {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(value)
}

export function providerDefinition(provider: string): ProviderDefinition {
  const definition = PROVIDER_CATALOG.find((candidate) => candidate.id === provider)
  if (!definition) throw new Error(`unsupported provider: ${provider}`)
  return definition
}

export function validateProviderCredentials(provider: string, credentials: Record<string, string>, authKind?: string): SupportedProvider {
  const definition = providerDefinition(provider)
  if (authKind && !(definition.auth as readonly string[]).includes(authKind)) {
    throw new Error(`${provider} does not support ${authKind} authentication`)
  }
  const required = [...definition.requiredCredentials]
  if (provider === 'fathom' && (authKind === 'api_key' || (!authKind && credentials.apiKey?.trim()))) required.splice(required.indexOf('accessToken'), 1, 'apiKey')
  const missing = required.filter((key) => !credentials[key]?.trim())
  if (provider === 'gong') {
    if (authKind === 'oauth' && !credentials.accessToken?.trim()) missing.push('accessToken')
    if (authKind !== 'oauth' && (!credentials.accessKey?.trim() || !credentials.accessKeySecret?.trim())) missing.push('accessKey/accessKeySecret')
  }
  if (provider === 'marketo') {
    if (authKind === 'service_account' && (!credentials.clientId?.trim() || !credentials.clientSecret?.trim())) missing.push('clientId/clientSecret')
    if (authKind === 'api_key' && !credentials.accessToken?.trim()) missing.push('accessToken')
  }
  if (provider === 'redshift' && !credentials.clusterIdentifier?.trim() && !credentials.workgroupName?.trim()) missing.push('clusterIdentifier/workgroupName')
  if (missing.length) throw new Error(`${provider} requires credential fields: ${[...new Set(missing)].join(', ')}`)
  return definition.id as SupportedProvider
}
