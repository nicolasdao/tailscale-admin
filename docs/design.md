# tailscale-admin: design

Phase 2 decisions, approved by Nic on 2026-10-19. Each item lists the choice, the rejected options and one line of reasoning. Research backing: `docs/research/`.

## 1. Language and runtime

**Chosen: Node, standard library only (built-in `fetch`), with `jsonc-parser` bundled inside the skill.** No `npm install`, nothing to compile.

| Rejected | Why |
|---|---|
| Python | Not guaranteed on macOS or Windows, and no proven comment-preserving JSONC editor exists in its standard library. Node is guaranteed for HappySkills users (`npx`) |
| Go (official client + `hujson`) | Needs Go plus a binary per platform. The client lags the spec, and `hujson.Format` reformats the whole file |
| bash + curl + jq | Policy editing would need a second language anyway, and keeping secrets off argv in shell is fragile |

## 2. Skill shape: one skill

**Chosen: a single skill, `tailscale-admin`.** Its description uses one umbrella verb ("Administer") plus concrete objects, at 250 characters or less, with one reference file per area loaded only when needed.

| Rejected | Why |
|---|---|
| Constellation (core plus `-policy` / `-devices` / `-tailnet` satellites) | Tailscale concepts cross every split. "Approve a route" lives in the policy, in devices and in the recipe, so satellites would break the orthogonality rule and route worse. There is one intent domain, one persona and a strong proper noun ("Tailscale") |

**Revisit if** the description cannot stay at 250 characters or less, or real prompts stop routing to the skill.

## 3. Command shape

**Chosen: one entry point, `node scripts/tsa.mjs <group> <verb> [flags]`.**

- **Curated commands** for common, safety-sensitive operations: `policy`, `devices`, `routes`, `keys`, `users`, `dns`, `settings`, `recipe`.
- **A generic layer**, `tsa api <METHOD> <path>`, reaches **all 93 operations**. Its paths are checked against the bundled OpenAPI spec, so no invented endpoints get through.
- **Output:** JSON by default. `--tailnet` defaults to `-`.

| Rejected | Why |
|---|---|
| One script per operation | 93 scripts, and drift between them |
| Curated commands only | Rarely used endpoints would be unreachable until hand-written |

## 4. Safety model

- **Reads run freely.** Every write **prints a plan first and changes nothing** unless `--apply` is given.
- If the desired state already holds, a write reports "already in place" and exits 0.
- **Destructive operations** (deleting a device, user, key or webhook) also require `--confirm <exact id or name>`.
- **Policy writes** always follow: HuJSON GET + ETag → insert-only edit → unified diff → `/acl/validate` (a non-empty body means failure) → POST with `If-Match`. On 412, re-read and re-plan; never retry blindly.
- **List-replacing endpoints** (routes, tags, DNS lists) are always read, merged, then written.
- **The generic layer** applies the same plan / `--apply` gate to any non-GET call.
- Whole-file policy replacement is never offered.

| Rejected | Why |
|---|---|
| Interactive y/n prompts | Agents can't answer TTY prompts. Explicit flags are scriptable and visible in the transcript |

## 5. Credentials and profiles

- **One OAuth client**, tagged `tag:tailscale-admin`, with scopes `all:read`, `policy_file`, `auth_keys`, `devices:core`, `devices:routes`. Never `all`, `oauth_keys` or `federated_keys`.
- **Created by hand in the console in two steps:**
  1. Add the tag to `tagOwners`.
  2. Create the client.

  The steps are in the setup guide.
- **Stored with the HappySkills env model:** `skill.json` `env` entries `TAILSCALE_OAUTH_CLIENT_ID` and `TAILSCALE_OAUTH_CLIENT_SECRET` (both `required`, `secret`), with a `setupGuide` and a `verify` command.
  - The values live in a git-ignored `.env` that `envFile` points at.
  - The agent checks presence only. Scripts read the values.
- **Least privilege per command:** each command requests **only the scopes it needs** when it exchanges for a token (narrowing is tested). For example, `devices list` gets `devices:core:read`.
- **The access token lives in memory for one run**, never on disk.
- **Profiles:** one tailnet in v1, with `--tailnet` for others.

| Rejected | Why |
|---|---|
| Personal API token | Expires within 90 days, has full admin power and is tied to one person. Its only unique power (creating invites) is out of scope |
| Shell-loaded `~/.config/vps/secrets.env` | It puts the admin secret in every process's environment |
| Token cache file | Saves a few hundred milliseconds per run at the cost of a bearer token on disk |
| Named profiles (à la switch-profile) | No second tailnet exists yet. `--tailnet` covers it |

## 6. Secret outputs (new auth keys)

**Chosen: `--out <file>` is required whenever a command creates a key.**
- The file is written with mode 0600 and the command refuses to overwrite.
- stdout reports only the key's ID, expiry and tags.
- The agent then hands the file to its consumer (e.g. `aws ssm put-parameter --value file://…`) and deletes it.

| Rejected | Why |
|---|---|
| Printing to stdout, even with `--reveal` | The agent's own tool output is in its context, so the key would end up in the transcript |

## 7. Recipes in v1

**Chosen:** `recipe subnet-router prepare` and `recipe subnet-router finish` (spec §4.9).
- The access-rule source is a **group** (`group:db-operators` by default, created if missing).
- The rule is appended to `grants` if the policy uses grants, otherwise to `acls`.

| Deferred | Why |
|---|---|
| Exit node, offboard user, rotate keys, tidy stale devices | Not needed yet. The primitives exist, so they can be added as recipes later |

## 8. v1 scope

**Chosen:**
- **All 93 operations are reachable** through `tsa api`.
- **Curated commands** cover: `policy` (get, sections, validate, preview, ensure-tag-owner, ensure-auto-approver, ensure-group, ensure-grant), `devices` (list, get, find, key-expiry, tags), `routes` (list, approve), `keys` (list, create-auth, revoke), `users list`, `dns get`, `settings get`, `self-audit`.
- Everything else is reached through `tsa api`, under the same safety gate.

## 9. Packaging and install

**Chosen:**
- Scaffold with `npx happyskills init tailscale-admin --json` in this repository. The skill folder is the publishable unit.
- This repository is public at `github.com/nicolasdao/tailscale-admin`.
- Publishing to HappySkills (`nicolasdao/tailscale-admin`) goes through `happyskills-publish`, only with Nic's explicit yes.
- No global PATH install: commands run as `node <skill>/scripts/tsa.mjs`.

## 10. Testing

- **Offline:** `node --test` covers the policy editor on sample HuJSON (comments, trailing commas, missing and empty blocks, duplicates, idempotency) and the safety gate.
- **Read-only live:** `scripts/test-live-readonly.mjs` exercises every curated read command plus `validate` and `preview`, under `:read`-scoped tokens.
- **Live writes:** only with Nic's go, preferably on throwaway objects.

## 11. Self-audit and self-update

- **Detection:** `tsa self-audit` downloads the live OpenAPI document and diffs it against the bundled copy (operations added, removed or changed, scopes, Alpha/deprecated flags). It exits non-zero on any change.
- **Maintenance:** the `SKILL.md` "Maintenance" section routes the follow-up to `happyskills-design` (Skill Update Workflow: divergence check, edit, validate), then `happyskills-publish` (version bump and release).
- **Publishing always needs a human yes.** This skill holds admin credentials for whoever installs it, so publishing an unreviewed AI-written change would be a supply-chain risk.
