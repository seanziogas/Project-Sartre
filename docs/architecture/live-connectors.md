# Live connector clients

The mainstream GTM integration catalog is implemented in `@sartre/connectors` behind `HttpTransport`. Production uses `FetchHttpTransport`; CI uses scripted transports and never holds live credentials. The catalog is exported as `SUPPORTED_PROVIDERS`, and both the ops connection picker and live connection test use that same registry.

| Provider | Implemented surface |
|---|---|
| Salesforce | Account/contact/opportunity/activity/lead reads; API health; snapshot-backed namespaced CRM writes; OAuth code exchange/refresh |
| HubSpot | Company/contact/deal/meeting/lead reads; API health; snapshot-backed namespaced CRM writes; OAuth code exchange/refresh |
| Attio | Company/person/deal/meeting reads; API health; snapshot-backed namespaced record writes; OAuth |
| Pipedrive | Organization/person/deal/activity/lead reads with cursor pagination; OAuth |
| Dynamics 365 Sales | Dataverse account/contact/opportunity/activity/lead reads; tenant-aware Microsoft OAuth |
| Zoho CRM | CRM V8 account/contact/deal/task/lead reads with page tokens and regional OAuth hosts |
| Clay | Client-owned enrichment webhook; optional live health endpoint, with configuration-only health when the client has no non-consuming health URL |
| Slack | OAuth health and approved message delivery |
| Microsoft Teams | Microsoft Graph health and approved channel-message delivery |
| Gmail / Microsoft Email | Mailbox health and approved email delivery through Gmail API or Microsoft Graph |
| Fathom | Meeting/transcript reads through API key or OAuth; token exchange/refresh |
| Gong | Transcript reads through a tenant-specific `*.api.gong.io` API base using access token or access-key authentication |
| Fireflies / Zoom | Paginated transcript reads; Fireflies GraphQL API key and Zoom OAuth |
| Smartlead | API health and reviewed bulk lead enrollment into an existing campaign |
| Instantly | API health and reviewed bulk lead enrollment into an existing campaign |
| Outreach | API health; reviewed prospect creation and enrollment into an existing sequence/mailbox |
| Salesloft | API health; reviewed person creation and cadence enrollment |
| Apollo | API health; reviewed contact creation and enrollment into an existing sequence |
| HeyReach / lemlist / Mailshake | Reviewed enrollment through client-configured, provider-host-constrained API routes |
| LinkedIn / Google / Meta Ads | Reviewed audience add/remove batches; email identifiers are normalized and SHA-256 hashed locally; supported OAuth flows |
| Snowflake | SQL API health and parameterized statements against the client's warehouse context, with bounded asynchronous polling and partition pagination |
| BigQuery | Jobs Query API health and parameterized Standard SQL against the client's project/location, with bounded job polling and result pagination; Google OAuth |
| Databricks | SQL Statement API execution with named parameters and bounded asynchronous status polling |
| Amazon Redshift | SigV4-signed, idempotent Data API execution with bounded status polling and paginated results |
| 6sense / G2 / Clearbit / Koala / Bombora | Raw intent-signal staging through client-configured, provider-host-constrained partner endpoints |
| Qualified / LinkedIn Lead Gen / Typeform / Chili Piper | Raw inbound-lead staging through client-configured, provider-host-constrained endpoints |
| Marketo | Paginated lead staging from a configured list on the tenant's `mktorest.com` instance using two-legged OAuth or a supplied short-lived token |

Provider behavior follows the current official surfaces. Stable public APIs receive native clients. Contract-specific and partner APIs receive typed adapters with client-configured routes that are constrained to the provider's HTTPS host; they cannot be used as arbitrary webhooks or internal-network request proxies. Clay remains client-configured because portfolio Clay tables and waterfall schemas vary by client.

## MCP transport (alongside the native clients)

Comms, meetings, and enrichment connections can run over an MCP server instead of the native REST client, so the two paths can be tested and benchmarked side by side against the same connector contract. A connection opts in by setting `transport: mcp` plus a `serverUrl` (HTTPS, or `http://localhost` for local development) and an optional bearer `accessToken` in its encrypted credentials; the same provider can be registered twice — once native, once MCP — to compare them. `createConnectorClient` selects the transport per connection, and `usesMcpTransport` tells the resolver to skip provider OAuth refresh for MCP connections (they authenticate to the MCP server, not the provider). The bridge (`McpConnectorClient`) maps each contract operation to a tool name — `send_message`, `list_transcripts`, `enrich` by default, overridable per connection with a `toolMap` JSON credential — validates required tools on `testConnection`, and fails closed on MCP tool errors or non-JSON results. CRM writes stay on the native clients so the snapshot-before-write invariant is unaffected. The MCP bridge is exercised in CI over the SDK's in-memory transport with a mock server; no live MCP endpoint is contacted.

Every client is resolved through `TenantConnectionResolver`. OAuth callback state is encrypted, client-bound, actor-bound, tamper-evident, and expires after ten minutes. Supported portal OAuth flows cover Salesforce, HubSpot, Slack, Teams, Fathom, Attio, Gong, Outreach, Salesloft, Gmail, Microsoft Email, Pipedrive, Dynamics 365, Zoho CRM, Zoom, LinkedIn Ads, LinkedIn Lead Gen, Google Ads, Meta Ads, Snowflake, BigQuery, Databricks, and Typeform. Access/refresh tokens are stored in the same encrypted connection envelope; rotating providers receive their new refresh token on refresh, and unexpired access tokens are not refreshed early. Marketo uses its tenant's two-legged client-credentials flow. The runner's `TenantToolClients` constructs clients per execution and never caches cleartext.

CRM writes require all three controls: fields pass the namespace guard, current source values are persisted in the client-scoped Postgres snapshot store, and the calling pipeline has already resolved its structural `crm_write` gate. Message, email, sequence, audience, and warehouse clients expose effect methods, but module pipelines cannot reach them before the corresponding structural human gate.

Connection testing is provider-specific. Read-only APIs make a minimal identity/read request. Warehouse clients issue a minimal query, which may generate a small provider-side usage charge. Partner-route adapters validate the provider host and either make a read-only pull or report configuration validity when the provider exposes no non-consuming health endpoint. Provider HTTP errors include a bounded, newline-sanitized provider message without echoing request credentials.

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
- [Pipedrive API reference](https://developers.pipedrive.com/docs/api/v1)
- [Microsoft Dataverse Web API](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/overview)
- [Zoho CRM V8 APIs](https://www.zoho.com/crm/developer/docs/api/v8/)
- [Google Data Manager audience ingestion](https://developers.google.com/data-manager/api/reference/rest/v1/audienceMembers/ingest)
- [Databricks Statement Execution API](https://docs.databricks.com/api/workspace/statementexecution)
- [Amazon Redshift Data API](https://docs.aws.amazon.com/redshift-data/latest/APIReference/Welcome.html)
- [Fireflies API](https://docs.fireflies.ai/)
- [Zoom cloud recordings](https://developers.zoom.us/docs/api/rest/reference/zoom-api/methods/#operation/recordingsList)
- [Marketo leads by list](https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/rest/lead-database/leads)
- [Model Context Protocol specification](https://modelcontextprotocol.io/specification)
