# Changelog

## [0.1.0] - 2026-10-19

First release.

- **`tsa` CLI** (Node 18+, no install step) over the Tailscale API v2. OAuth client credentials, with each command requesting only the scopes it needs.
- **Policy file:** `get`, `validate`, `preview`, and comment-preserving `ensure-*` / `remove-*` edits. Every edit is validated, shown as a unified diff and written with `If-Match`.
- **Devices and routes:** list with server-side filters, get, key expiry, tags, authorize, delete. Routes are listed, approved and removed with read-merge-write.
- **Keys:** list, create tagged auth keys (the secret goes to a 0600 file only), revoke.
- **Reads:** users, DNS, settings.
- **Generic layer:** `tsa api` reaches every operation in the official OpenAPI document, under the same plan / `--apply` / `--confirm` gate, with secret fields redacted.
- **Recipe:** `recipe subnet-router prepare | finish`, idempotent end to end.
- **Maintenance:** `self-audit` diffs the live OpenAPI document against the bundled operation index.
- **Tests:** read-only live suite (`scripts/test-live-readonly.mjs`).
