# Maintenance: keeping the skill in step with the Tailscale API

The skill ships `assets/operations.json`, an index derived from Tailscale's OpenAPI document: method, path, summary, documented scopes, Alpha/deprecated flags and a fingerprint per operation. Tailscale warns the document "may change or break without notice", so audit it.

## 1. Detect

```bash
node "${CLAUDE_SKILL_DIR}/scripts/tsa.mjs" self-audit
```

- Exit 0, `"status": "up_to_date"`: nothing to do.
- Exit 3, `"status": "drift"`: `added`, `removed` and `changed` list the operations. `changed` names the fields (summary, scopes, badges, deprecated, or "details" for parameters and schemas).

Also skim https://tailscale.com/changelog for API entries since the index's `generated` date. Behaviour changes do not always reach the document.

## 2. Assess

For each item:
- **Added:** already reachable through `tsa api`. Decide whether it deserves a curated command (frequent, safety-sensitive, or list-replacing).
- **Removed or deprecated:** find curated commands or recipes that call it (`grep -rn '<path fragment>' scripts/`), and plan a replacement.
- **Scopes changed:** update the `scopes` used by the matching command, `references/setup.md`, and the scope list in `references/commands.md`.
- **Details changed:** re-read the operation at https://tailscale.com/api and check request and response fields used in `scripts/commands/`.

## 3. Update the skill (a content update)

Route this to **happyskills-design** ("update the tailscale-admin skill based on the self-audit"). Its Skill Update Workflow runs the divergence pre-flight, then:
1. `self-audit --update-index` to refresh `assets/operations.json`.
2. Edit commands, references and gotchas for what changed.
3. Run the offline tests (`node --test test/` in the source repo) and the read-only live test (`scripts/test-live-readonly.mjs`).
4. `npx happyskills validate tailscale-admin --json`.

## 4. Release

Route to **happyskills-publish** ("release tailscale-admin"). It owns the version bump:
- new operations or commands → minor
- removed or changed behaviour → major
- fixes → patch

**Publishing always needs the maintainer's explicit yes.** This skill holds admin credentials for everyone who installs it, so an unreviewed automated release is a supply-chain risk.
