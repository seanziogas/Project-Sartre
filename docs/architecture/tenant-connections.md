# Tenant-owned tool connections

Sartre access is independent of connector availability. A client can sign in, review work, inspect health, and use connector-free capabilities before connecting any external tool.

The client portal exposes a tenant-scoped Connections page. Viewers can inspect connection status; internal admins, GTMEs, and designated client approvers can add or revoke credentials for their client only. Submitted secrets are write-only: the browser never receives them again, and revocation destroys the stored credential envelope.

Credentials are stored in Postgres as AES-256-GCM envelopes. The deployment owns a versioned keyring of 32-byte base64 encryption keys; it never lives in a client manifest, Brain, or git. Each new envelope records its key ID, and authenticated encryption binds it to its `client_id`, so moving ciphertext between tenants cannot produce usable credentials. Legacy single-key envelopes can be read during migration and are rewrapped opportunistically when resolved. `npm run rotate-credentials` performs an explicit bulk rewrap and appends a tenant-scoped rotation audit event without printing credentials.

OAuth authorization uses PKCE with a fresh high-entropy verifier and an S256 challenge. The verifier is carried only inside encrypted, expiring callback state and is supplied during the authorization-code exchange. OAuth credentials are still client-owned and remain revocable from the Connections page.

The runner starts without a connector bundle or encryption key. Deployment adapters receive a `TenantConnectionResolver` and explicitly resolve a connection for the current `clientId` only when a pipeline step needs it. Cleartext is not cached. Missing adapters, keys, or provider connections fail at that execution boundary with a scoped configuration error.

Connecting a tool does not grant operational authority. CRM writes, outbound sends, client communications, internal reports, and Brain changes remain behind their existing structural human gates.
