---
name: tailscale-admin
description: Tailscale — Administer a tailnet via its API, the policy file, ACLs, auth keys, devices, subnet routes and DNS. Use when approving a route, creating an auth key, adding a tag owner or setting up a subnet router. Not for the local tailscale CLI.
allowed-tools: Bash, Read, AskUserQuestion
---

# Tailscale admin

Administer a Tailscale tailnet through the official API v2 with one script, `tsa`. It covers the policy file (tag owners, auto-approvers, groups, access rules), auth keys, devices, subnet routes, DNS, users and settings. A generic layer reaches **every** API operation, and a recipe sets up a subnet router end to end.

Run everything as:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/tsa.mjs" <group> <verb> [flags]
```

`node "${CLAUDE_SKILL_DIR}/scripts/tsa.mjs" help` lists every command. Full reference: [references/commands.md](references/commands.md).

This skill is **not** for the local node (`tailscale up`, `set`, `serve`, `status`): use the `tailscale` CLI directly for those.

## Setup and configuration

> **Resolve configuration before using any default — there is one correct way; follow it, don't improvise.** Prefer `happyskills skills-config get <owner>/<name> --json`: it returns the merged non-secret `config`, the resolved `envFile`, the required-secret names, and a present/absent flag. If the CLI is unavailable, do the **same** resolution by hand, in this exact order:
>
> 1. **Find the project root.** Search upward from your current directory for the nearest `skills-config.json` or `skills-lock.json`, stopping at a `.git` boundary. That directory is the project root.
> 2. **Read the config.** In that project root, read `skills-config.json` (then the global `~/.agents/skills-config.json`) under the key `<owner>/<name>`. Anything unset falls back to this skill's hardcoded defaults.
> 2b. **ABSENT ≠ CORRUPT — never `catch { return null }`.** A *missing* `skills-config.json` legitimately means "nothing configured yet" → fall back to defaults. A file that *exists but does not parse* means the consumer's settings are **unreadable**, and quietly treating that as "nothing configured" is a silent failure: the skill runs with the wrong settings and reports success. **Stat the path first**: absent → defaults; present-but-unparseable → **throw**, naming the file and telling the user to run `npx -y happyskills skills-config validate --json` (which reports the exact line, column, and how to fix it) — and to repair it **in place**, never to delete it, because it holds every configured skill's settings.
> 3. **Resolve `envFile` against the directory of the `skills-config.json` that declared it — NOT your current directory.** Use the project file's `envFile` if it declares one; otherwise the global file's. The `envFile` value (e.g. `./secrets/x.env`) is relative to the directory holding the `skills-config.json` it came from: a value from the project file resolves against the project root (step 1); a value from the global `~/.agents/skills-config.json` resolves against `~/.agents`. Join it to that directory to get the real path — never to the directory you happen to be running from. **This is the one step that is easy to get wrong: resolving it against your current working directory makes the skill work from the project root but fail from any subdirectory. Anchor it to the declaring config file's own directory and it works from anywhere.**
> 4. **Never read a secret's value into your own context.** Do not `Read`, `cat`, `echo`, or open the `envFile` to inspect a secret, and never inline a secret into a `fetch`/`curl`/command string. The value must pass straight from the `.env` into the process that needs it: run the skill's script or CLI with the `envFile` loaded into that child process's environment (e.g. `set -a; . ./secrets/<skill>.env; set +a; <tool> …`, or a `scripts/*.mjs` that reads `process.env`), so that only the subprocess — never you — ever sees the token. An ambient environment variable of the same name takes precedence over the file.
> 5. **Check presence, not value.** Use the `secretsPresent` flag from `skills-config get` to decide whether you can run (CLI-less, test that the variable is non-empty) — never print or echo it. If a required secret is missing, **STOP** and tell the user exactly which variable to set and in which file.

For this skill, `<owner>/<name>` is `nicolasdao/tailscale-admin`. `tsa.mjs` already implements this resolution and loads the secrets itself. Run `tsa auth check`; it reports `credentials_missing` (with the file and variable names) or the granted scopes.

- **Secrets:** `TAILSCALE_OAUTH_CLIENT_ID` and `TAILSCALE_OAUTH_CLIENT_SECRET`, from an OAuth client that only a person can create in the Tailscale console.
  - Install creates the secrets file **with both values empty**, git-ignored:
    - `<project>/secrets/tailscale-admin.env` for a project install;
    - `~/.agents/secrets/tailscale-admin.env` for a global install.
  - **Right after install** (the install returns `next_step.action: complete_manual_setup`), and whenever a command returns `credentials_missing`, walk the user through [references/setup.md](references/setup.md) step by step. It also covers locking the file to mode 600 and moving it elsewhere.
  - The user types the values into the file themselves. Never ask for the secret in chat.
- **Config:**
  - `tailnet` (default `-`)
  - `automationTag` (default `tag:tailscale-admin`, the OAuth client's tag)
  - `operatorGroup` (default `group:db-operators`)
  - `keyExpiry` (default `1d`)

  Command flags override config.

## Safety model: tight rails on every write

1. **Reads run freely.** Every write **prints a plan and changes nothing** unless `--apply` is passed.
2. **Show the plan, then ask.** Present the `changes` (and the `diff` for policy edits) in plain English, and get the user's go with AskUserQuestion. Only then re-run the same command with `--apply`. Never add `--apply` on the first run of a write.
3. **Destructive operations** (deleting a device or key, any `api DELETE`) also need `--confirm <exact target>`. Name the target to the user before confirming.
4. **Policy edits:**
   - Every edit is a targeted insertion that preserves every comment and byte of unrelated text.
   - Each edit is validated with Tailscale before it is written, and written with `If-Match`.
   - Whole-file policy replacement is not offered and must not be improvised (for example, by posting `policy get --raw` back through `curl`).
5. **New auth keys go only to a 0600 file** (`--out` / `--key-out`). Never `cat` the file. Hand it to its consumer by path, then delete it.

## Reading results

Lead with the plain-English meaning; quote JSON values only if the user asks.

| `status` | Plain-English meaning (use as your opening sentence) | Next |
|---|---|---|
| `planned` | "Here is what I would change; nothing has been changed yet." | Show `changes` / `diff`, ask, then re-run with `--apply` |
| `applied` | "Done: the change is live on the tailnet." | Report what changed |
| `already_in_place` | "Nothing to do: the tailnet is already in the requested state." | Stop |
| `refused` | "I stopped before changing anything because …" (use `reason`) | Explain `reason` / `validation` / `clashes`, and ask how to proceed |
| `error` | "The command failed: …" (use `error.message`) | `error.code` guides the fix (below) |

| `error.code` | Meaning | Fix |
|---|---|---|
| `credentials_missing` | The client ID or secret is not set | [references/setup.md](references/setup.md) |
| `auth_failed` | The token exchange was rejected | Wrong or revoked client, or it lacks a scope the command requested |
| `api_error` | Tailscale returned an error (`httpStatus`, message) | 403 means a missing scope, or a feature not on the current plan |
| `confirmation_required` | A destructive command lacks `--confirm <target>` | Confirm with the user first |
| `device_ambiguous` / `device_not_found` | The hostname matches several devices, or none | Use the node ID from `matches` / `similar` |
| `unknown_operation` | `api` path not in the bundled index | Check the path, or run `self-audit` |
| `policy_*` | The policy editor refused (`policy_guard`: an internal safety stop) | Report verbatim; edit by hand in the admin console if needed |

## Common tasks

| User says | Command |
|---|---|
| "Set up a subnet router for …" | `recipe subnet-router prepare …`, then `finish …`. See [references/recipes.md](references/recipes.md) |
| "Approve the route" | `routes list --device D`, then `routes approve --device D --cidr C` |
| "Create a Tailscale auth key" | `keys create-auth --tag T --out FILE` (OAuth keys must be tagged) |
| "Add a tag owner" | `policy ensure-tag-owner --tag T --owner O` |
| "Let X reach Y on port P" | `policy ensure-rule --src X --dst CIDR --port P` |
| "Who can reach …?" | `policy preview --type user\|ipport --for …` |
| "Lock down the allow-all rule" | `policy replace-rule --from '{"src":["*"],"dst":["*"],"ip":["*"]}' --to '{"src":["autogroup:member"],"dst":["*"],"ip":["*"]}' --comment "…"`. Add `ensure-test` checks first so the save proves nothing breaks |
| "Make sure X can always reach Y" / "X must never reach Y" | `policy ensure-test --src X --accept Y:port` / `--deny Y:port` |
| "Disable key expiry on the router" | `devices key-expiry --device D --disable` |
| Anything else in the API | `api list`, then `api <METHOD> <path>` |

## Gotchas

- **`/acl/validate` returns HTTP 200 even when the policy is invalid.** Only an empty body means valid. `tsa` handles this. If you call the API directly, check the body.
- **Route, tag and DNS list endpoints replace the whole list.** Use `tsa` (read, merge, write), never raw `api POST …/routes` with only the new CIDR.
- **OAuth clients can only mint *tagged* auth keys**, and only for their own tags or tags those tags own in `tagOwners`. The recipe adds that ownership first.
- **Auto-approval fires when a route is advertised.** A route already pending before the approver existed may need `routes approve`, which `finish` checks.
- **Single-use keys are revoked automatically the moment a device uses them**, so `--revoke-key` then reports `already_in_place`.
- **Device key expiry ≠ auth-key expiry.** Tagged devices have key expiry off by default. User-owned routers do not, and they drop off when it lapses.
- **Re-joins create `hostname-1` devices.** `finish` refuses until the stale ones are deleted.
- **`GET /keys` without `all=true` lists only OAuth clients for an OAuth token.** `keys list` passes it.
- **A 403 "feature not available on current billing plan"** means plan gating (log streaming, network flow logs, custom posture attributes).
- **Policy `tests` are enforced on every save.** A change that breaks one comes back `refused` with the failing test in `validation`. That is the safety net working. To deliberately widen access (e.g. undo a lockdown), remove or adjust the blocking test first, with the user's agreement. A test whose `src` names a tag missing from `tagOwners` fails **every** test ("tag not found"), so add the tag owner first.
- **The API documents no rate limits.** `tsa` backs off on 429 and 5xx, honouring `Retry-After`.

## Constraints

- **NEVER** run a write with `--apply` before showing the plan and getting the user's explicit go for that exact change.
- **NEVER** print, echo, `cat` or `Read` a secret: the env file, a `--key-out` / `--out` file, or a token. Never put one on a command line.
- **NEVER** replace the whole policy file, or convert `acls` ↔ `grants`. Only targeted `policy ensure-*` / `remove-*` edits.
- **NEVER** create credentials that can mint credentials (`oauth_keys`, `federated_keys`, `all`) for this skill.
- **NEVER** invent endpoints or fields: `api` only accepts operations in `assets/operations.json`.
- **ALWAYS** stop and ask when `prepare` reports overlapping routes, validation fails, or `finish` lists duplicate devices.

## Verification

- After any write, re-read the state (`devices get`, `routes list`, `policy get`) and report it.
- Read-only live test (writes nothing): `node "${CLAUDE_SKILL_DIR}/scripts/test-live-readonly.mjs"`. Every line should say `PASS`.
- Offline editor tests live in the source repository: `node --test test/`.

## Maintenance

`node "${CLAUDE_SKILL_DIR}/scripts/tsa.mjs" self-audit` diffs the live Tailscale OpenAPI document against the bundled index (exit 3 = drift). To bring the skill up to date and release it, follow [references/maintenance.md](references/maintenance.md).
