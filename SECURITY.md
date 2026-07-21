# Security

Project Sartre is a multi-tenant platform that holds client GTM data and encrypted
tool credentials. This document summarizes the security model and how to report issues.

## Reporting a vulnerability

Report privately — **do not open a public issue.** Use GitHub's private vulnerability
reporting for this repository (Security → Report a vulnerability), or contact the
maintainer directly. Please include reproduction steps and affected components. We aim to
acknowledge reports promptly and will coordinate a fix and disclosure timeline with you.

## Security model

- **Hard tenant isolation.** Every tenant table has `FORCE ROW LEVEL SECURITY` with a
  policy keyed on a transaction-local `sartre.client_id` GUC set per query. Fleet-wide
  queries opt in explicitly via `sartre.system_access`. **The application must connect as a
  restricted, non-owner, non-`BYPASSRLS` role** — a superuser, table owner without FORCE, or
  `BYPASSRLS` role defeats isolation. (See ADR 0002.)
- **Credential encryption.** Tool-connection credentials are sealed with AES-256-GCM using a
  deployment-owned, versioned keyring (`SARTRE_CREDENTIAL_ENCRYPTION_KEYS` +
  `SARTRE_CREDENTIAL_CURRENT_KEY_ID`). The database stores only opaque ciphertext;
  decryption happens at execution time and is never cached. Revocation blanks the ciphertext
  and writes an audit event. OAuth uses PKCE with short-lived, encrypted callback state.
  (See ADR 0003.)
- **Human gates on outward effects.** Sends, CRM writes, sequence enrollments, and audience
  syncs stop at a structural review gate before dispatch; approvals are attributed and
  captured as feedback events.
- **Non-destructive writes.** Snapshot-before-write, namespaced CRM fields only, full run
  journal, and per-field provenance.
- **Portability.** Tenant portability bundles are checksum-verified and credential-free;
  restore requires an approved governance request and an empty destination. (See ADR 0004.)
- **Auth.** The ops portal delegates authentication to a deployment-owned identity proxy that
  injects a verified `x-sartre-user-id`; a middleware backstop rejects any request lacking an
  asserted identity. RBAC is enforced per page and server action.
- **MCP transport.** MCP connector `serverUrl`s are validated to block link-local/metadata
  and private/loopback hosts by default (SSRF guard); private hosts require an explicit
  opt-in for local development.

## Handling secrets

Never commit credentials. `.env` is gitignored; `.env.example` uses placeholders only. Tests
run against PGlite with scripted fakes and require no live keys. Deployment secrets
(`DATABASE_URL`, the credential keyring, `ANTHROPIC_API_KEY`, OAuth client secrets) live in
your secret manager, never in the repo or client directories.
