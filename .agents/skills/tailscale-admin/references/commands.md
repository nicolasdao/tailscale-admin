# Command reference

Run every command as `node "${CLAUDE_SKILL_DIR}/scripts/tsa.mjs" <group> <verb> [flags]`. `--help` after a group lists its verbs. Repeatable flags take several values (`--cidr A --cidr B`, or `--cidr A,B`). Every command prints one JSON object.

`--tailnet <id>` targets another tailnet. The default is the configured `tailnet`, normally `-` (the credential's own).

## Policy file

| Command | What it does | Scope requested |
|---|---|---|
| `policy get` | Section shapes, tag owners, groups, auto-approved routes, rule section (`grants`/`acls`), ETag | `policy_file:read` |
| `policy get --raw` | The HuJSON text with comments. Show it only when the user asks | `policy_file:read` |
| `policy validate --file F` | Validates a local HuJSON file. Never applies it | `policy_file:read` |
| `policy preview --type user\|ipport --for X [--file F]` | Which rules match a user email or an `ip:port`, under the current policy or file F | `policy_file:read` |
| `policy ensure-tag-owner --tag T --owner O...` | Adds T to `tagOwners`, or adds owners to it | `policy_file` |
| `policy ensure-auto-approver --route CIDR --approver A...` | `autoApprovers.routes[CIDR]` gains A | `policy_file` |
| `policy ensure-exit-node-approver --approver A` | `autoApprovers.exitNode` gains A | `policy_file` |
| `policy ensure-group --group group:G --member M...` | Creates the group or adds members | `policy_file` |
| `policy ensure-rule --src S... --dst CIDR... --port P... [--proto tcp]` | Appends an access rule to `grants` (or to `acls` if the policy uses acls) | `policy_file` |
| `policy remove-tag-owner --tag T` / `remove-auto-approver --route C` / `remove-rule --src S --dst C --port P` | Removes an entry **only if it sits alone on its own lines** (anything the ensure commands added qualifies) | `policy_file` |

Every `ensure-*` and `remove-*` command returns `changes`, a unified `diff`, and the validation result. With `--apply` it writes with `If-Match`.

## Devices and routes

| Command | What it does | Scope |
|---|---|---|
| `devices list [--tag T...] [--hostname H] [--os O]` | Server-side filters, exact match. Several filters combine with AND | `devices:core:read` |
| `devices get --device D [--full]` | `D` = node ID, numeric ID or exact hostname. An ambiguous hostname is refused, with the matches listed | `devices:core:read` |
| `devices key-expiry --device D --disable\|--enable` | Node-key expiry (separate from auth-key expiry) | `devices:core` |
| `devices tags --device D [--add T...] [--remove T...]` | Read, merge, then write the tag list | `devices:core` |
| `devices authorize --device D` | Approves a device that is waiting for approval | `devices:core` |
| `devices delete --device D --confirm D` | Destructive. The device must re-authenticate to rejoin | `devices:core` |
| `routes list --device D` | Advertised, enabled and pending routes | `devices:core:read` |
| `routes approve --device D --cidr C...` | Adds to the enabled list (read, merge, write). Warns if C is not advertised yet | `devices:routes` |
| `routes remove --device D --cidr C...` | Removes from the enabled list | `devices:routes` |

## Keys

| Command | What it does | Scope |
|---|---|---|
| `keys list` | Every key: auth keys, OAuth clients, API tokens. Metadata only | `all:read` |
| `keys create-auth --tag T... --out FILE [--expiry 1d] [--reusable] [--ephemeral] [--no-preauthorized] [--description S]` | A tagged auth key. **The secret goes only into FILE** (mode 0600, never overwritten). Pre-authorised by default | `auth_keys` |
| `keys revoke --key ID --confirm ID` | Destructive. Devices that already joined stay joined | `auth_keys` |

## Other reads

`users list` (`users:read`), `dns get` (`dns:read`, full DNS configuration), `settings get` (`feature_settings:read`).

## Generic layer: every API operation

| Command | What it does |
|---|---|
| `api list [--tag Devices]` | Every operation in the bundled index, with its documented scopes and Alpha badges |
| `api GET <path> [--query k=v...] [--scope S...]` | Runs any read. Path IDs are concrete (`/device/nABC123CNTRL/routes`). The default scope is `all:read` |
| `api <POST\|PUT\|PATCH\|DELETE> <path> [--body JSON \| --body-file F] [--apply]` | Plans unless `--apply` is given. DELETE also needs `--confirm <path>`. Whole-file `POST /acl` is refused |
| `... --out FILE` | Saves the full response (mode 0600) when it carries a secret. Secret-named fields are always blanked on stdout |

The path must match an operation in `assets/operations.json`, or the command refuses. Find exact paths, bodies and scopes in the API docs (https://tailscale.com/api) or in `docs/research/api-surface.md` in the source repository.

## Maintenance

`self-audit [--update-index]`: see [maintenance.md](maintenance.md).
