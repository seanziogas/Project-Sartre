# Live connector clients

The mainstream GTM integration catalog is implemented in `@sartre/connectors` behind `HttpTransport`. Production uses `FetchHttpTransport`; CI uses scripted transports and never holds live credentials. The catalog is exported as `SUPPORTED_PROVIDERS`, and both the ops connection picker and live connection test use that same registry.

| Provider | Implemented surface |
|---|---|
| Salesforce | Account/contact/opportunity/activity/lead reads; API health; snapshot-backed namespaced CRM writes; OAuth code exchange/refresh |
| HubSpot | Company/contact/deal/meeting/lead reads; API health; snapshot-backed namespaced CRM writes; OAuth code exchange/refresh |
| Attio | Company/person/deal/meeting reads; API health; snapshot-backed namespaced record writes |
| Clay | Client-owned enrichment webhook; optional live health endpoint, with configuration-only health when the client has no non-consuming health URL |
| Slack | OAuth health and approved message delivery |
| Microsoft Teams | Microsoft Graph health and approved channel-message delivery |
| Gmail / Microsoft Email | Mailbox health and approved email delivery through Gmail API or Microsoft Graph |
| Fathom | Meeting/transcript reads through API key or OAuth; token exchange/refresh |
| Gong | Transcript reads through a tenant-specific `*.api.gong.io` API base using access token or access-key authentication |
| Smartlead | API health and reviewed bulk lead enrollment into an existing campaign |
| Instantly | API health and reviewed bulk lead enrollment into an existing campaign |
| Outreach | API health; reviewed prospect creation and enrollment into an existing sequence/mailbox |
| Salesloft | API health; reviewed person creation and cadence enrollment |
| Apollo | API health; reviewed contact creation and enrollment into an existing sequence |
| HeyReach / lemlist / Mailshake | Reviewed enrollment through client-configured, provider-host-constrained API routes |
| LinkedIn Ads | Marketing API health and reviewed Matched Audience email add/remove batches; emails are normalized and SHA-256 hashed locally |
| Snowflake | SQL API health and parameterized statements against the client's warehouse context |
| BigQuery | Jobs Query API health and parameterized Standard SQL against the client's project/location |
| 6sense / G2 / Clearbit / Koala / Bombora | Raw intent-signal staging through client-configured, provider-host-constrained partner endpoints |
| Qualified / LinkedIn Lead Gen / Typeform / Chili Piper | Raw inbound-lead staging through client-configured, provider-host-constrained endpoints |

Provider behavior follows the current official surfaces. Stable public APIs receive native clients. Contract-specific and partner APIs receive typed adapters with client-configured routes that are constrained to the provider's HTTPS host; they cannot be used as arbitrary webhooks or internal-network request proxies. Clay remains client-configured because portfolio Clay tables and waterfall schemas vary by client.

Every client is resolved through `TenantConnectionResolver`. OAuth callback state is encrypted, client-bound, actor-bound, and expires after ten minutes. Access/refresh tokens are stored in the same encrypted connection envelope; rotating providers receive their new refresh token on refresh. The runner's `TenantToolClients` constructs clients per execution and never caches cleartext.

CRM writes require all three controls: fields pass the namespace guard, current source values are persisted in the client-scoped Postgres snapshot store, and the calling pipeline has already resolved its structural `crm_write` gate. Message, email, sequence, audience, and warehouse clients expose effect methods, but module pipelines cannot reach them before the corresponding structural human gate.

Connection testing is provider-specific. Read-only APIs make a minimal identity/read request. Snowflake and BigQuery issue a minimal query, which may generate a small provider-side usage charge. Partner-route adapters validate the provider host and either make a read-only pull or report configuration validity when the provider exposes no non-consuming health endpoint.

Official references:

- [Salesforce object data APIs](https://developer.salesforce.com/blogs/2024/04/accessing-object-data-with-salesforce-platform-apis)
- [HubSpot object APIs](https://developers.hubspot.com/docs/api-reference/latest/crm/using-object-apis)
- [HubSpot OAuth token management](https://developers.hubspot.com/docs/api-reference/latest/authentication/manage-oauth-tokens)
- [Attio list records](https://docs.attio.com/rest-api/endpoint-reference/records/list-records)
- [Slack Web API](https://docs.slack.dev/apis/web-api/)
- [Microsoft Graph channel messages](https://learn.microsoft.com/en-us/graph/api/chatmessage-post?view=graph-rest-1.0)
- [Fathom meetings API](https://developers.fathom.ai/api-reference/meetings/list-meetings)
- [Gong call transcripts](https://help.gong.io/apidocs/retrieve-transcripts-of-calls-by-date-or-callids-v2callstranscript-2)
- [Smartlead campaign leads](https://api.smartlead.ai/api-reference/campaigns/add-leads)
- [Instantly bulk leads](https://developer.instantly.ai/api-reference/lead/add-leads-in-bulk-to-a-campaign-or-list)
- [Outreach API common patterns](https://developers.outreach.io/api/common-patterns)
- [Salesloft cadence memberships](https://developers.salesloft.com/docs/api/cadence-memberships-create/)
- [Apollo authentication](https://docs.apollo.io/reference/authentication)
- [LinkedIn DMP Segment Users](https://learn.microsoft.com/en-us/linkedin/marketing/matched-audiences/create-and-manage-segment-users)
- [Snowflake SQL API requests](https://docs.snowflake.com/en/developer-guide/sql-api/submitting-requests)
- [BigQuery synchronous queries](https://docs.cloud.google.com/bigquery/docs/reference/rest/v2/jobs/query)
