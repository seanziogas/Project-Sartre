# Live connector clients

The first portfolio-frequency tier is implemented in `@sartre/connectors` behind `HttpTransport`. Production uses `FetchHttpTransport`; CI uses scripted transports and never holds live credentials.

| Provider | Implemented surface |
|---|---|
| Salesforce | Account/contact/opportunity/activity/lead reads; API health; snapshot-backed namespaced CRM writes; OAuth code exchange/refresh |
| HubSpot | Company/contact/deal/meeting/lead reads; API health; snapshot-backed namespaced CRM writes; OAuth code exchange/refresh |
| Clay | Client-owned enrichment webhook and configuration health |
| Slack | OAuth health and approved message delivery |
| Microsoft Teams | Microsoft Graph health and approved channel-message delivery |
| Fathom | Meeting/transcript reads through API key or OAuth; token exchange/refresh |
| Smartlead | API health and reviewed bulk lead enrollment into an existing campaign |
| Instantly | API health and reviewed bulk lead enrollment into an existing campaign |
| LinkedIn Ads | Marketing API health and reviewed Matched Audience email add/remove batches; emails are normalized and SHA-256 hashed locally |

Provider behavior follows the current official surfaces: Salesforce REST resources under the versioned `/services/data/v67.0` root, HubSpot `/crm/v3/objects` APIs and 2026-03 OAuth endpoints, Slack Web API v2 OAuth and `chat.postMessage`, Microsoft Graph channel messages, Fathom External API meetings/transcripts, Smartlead campaign leads, Instantly v2 bulk leads, and LinkedIn DMP Segment Users. Clay is intentionally a client-configured webhook because portfolio Clay tables and waterfall schemas vary by client; the adapter does not assume a shared table.

Every client is resolved through `TenantConnectionResolver`. OAuth callback state is encrypted, client-bound, actor-bound, and expires after ten minutes. Access/refresh tokens are stored in the same encrypted connection envelope; rotating providers receive their new refresh token on refresh. The runner's `TenantToolClients` constructs clients per execution and never caches cleartext.

CRM writes require all three controls: fields pass the namespace guard, current source values are persisted in the client-scoped Postgres snapshot store, and the calling pipeline has already resolved its structural `crm_write` gate. Slack/Teams clients expose send methods, but module pipelines cannot reach them before their outbound or client-communications gate.

Official references:

- [Salesforce object data APIs](https://developer.salesforce.com/blogs/2024/04/accessing-object-data-with-salesforce-platform-apis)
- [HubSpot object APIs](https://developers.hubspot.com/docs/api-reference/latest/crm/using-object-apis)
- [HubSpot OAuth token management](https://developers.hubspot.com/docs/api-reference/latest/authentication/manage-oauth-tokens)
- [Slack Web API](https://docs.slack.dev/apis/web-api/)
- [Microsoft Graph channel messages](https://learn.microsoft.com/en-us/graph/api/chatmessage-post?view=graph-rest-1.0)
- [Fathom meetings API](https://developers.fathom.ai/api-reference/meetings/list-meetings)
- [Smartlead campaign leads](https://api.smartlead.ai/api-reference/campaigns/add-leads)
- [Instantly bulk leads](https://developer.instantly.ai/api-reference/lead/add-leads-in-bulk-to-a-campaign-or-list)
- [LinkedIn DMP Segment Users](https://learn.microsoft.com/en-us/linkedin/marketing/matched-audiences/create-and-manage-segment-users)
