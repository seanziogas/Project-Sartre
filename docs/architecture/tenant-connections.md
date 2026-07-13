# Tenant-owned tool connections

Sartre access is independent of connector availability. A client can sign in, review work, inspect health, and use connector-free capabilities before connecting any external tool.

The client portal exposes a tenant-scoped Connections page. Viewers can inspect connection status; internal admins, GTMEs, and designated client approvers can add or revoke credentials for their client only. Submitted secrets are write-only: the browser never receives them again, and revocation destroys the stored credential envelope.

Credentials are stored in Postgres as AES-256-GCM envelopes. The deployment owns the 32-byte base64 encryption key; it never lives in a client manifest, Brain, or git. Authenticated encryption binds every envelope to its `client_id`, so moving ciphertext between tenants cannot produce usable credentials.

The runner starts without a connector bundle or encryption key. Deployment adapters receive a `TenantConnectionResolver` and explicitly resolve a connection for the current `clientId` only when a pipeline step needs it. Cleartext is not cached. Missing adapters, keys, or provider connections fail at that execution boundary with a scoped configuration error.

Connecting a tool does not grant operational authority. CRM writes, outbound sends, client communications, internal reports, and Brain changes remain behind their existing structural human gates.
