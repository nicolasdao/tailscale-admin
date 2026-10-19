# Changelog

## [0.2.0] - 2026-10-19

- **`policy replace-rule --from <rule JSON> --to <rule JSON> [--comment]`** swaps one access rule in place. It can also rewrite the comment lines directly above the rule, for example to replace Tailscale's default allow-all rule with a narrower one. Idempotent, and refuses clearly when the rule is not found.
- **`policy ensure-test` / `policy remove-test`** manage policy tests: safety checks Tailscale runs on every save, refusing any change that breaks them. They merge into the existing test for the same source.
- Gotcha documented: a change that breaks a test is refused, so deliberate widening needs the test adjusted first.

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
