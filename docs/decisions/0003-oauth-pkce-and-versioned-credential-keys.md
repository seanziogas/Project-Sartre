# ADR 0003 — OAuth PKCE and versioned credential keys

**Date:** 2026-07-14 · **Status:** Accepted

## Context

OAuth authorization-code flows needed proof-of-possession protection. A single unversioned encryption key made routine rotation risky because stored envelopes did not identify which key could open them.

## Decisions

1. OAuth authorization uses a fresh PKCE verifier and S256 challenge. The verifier travels only inside encrypted, expiring callback state and is submitted at token exchange.
2. New credential envelopes include a key ID and use the current key from a deployment-owned keyring.
3. The vault reads envelopes written by retained old keys and legacy single-key deployments. Runtime resolution opportunistically rewraps old envelopes; a bulk rotation command provides deterministic migration and audited counts.

## Consequences

Intercepted OAuth codes cannot be exchanged without the verifier. Key rotation can be staged, verified, and rolled back without exposing credential plaintext or taking connector-free platform access offline.
