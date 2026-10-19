# Tailscale API: authentication and authorisation

Research for the `tailscale-admin` skill, written 2026-10-19. Every claim cites its source. "Tested" means a live, read-only call made on 2026-10-19.

## 1. Credential types

### 1.1 Personal API access token (`tskey-api-…`)

| Aspect | Fact | Source |
|---|---|---|
| Created | Admin console, Settings → Keys. **Cannot be created through the API**: `POST /keys` accepts `keyType` `auth`, `client` or `federated` only | https://tailscale.com/docs/reference/tailscale-api; spec `POST /tailnet/{tailnet}/keys` |
| Who can create | Owner, Admin, IT admin, Network admin | https://tailscale.com/docs/reference/tailscale-api |
| Lifetime | 1 to 90 days, chosen at creation. Cannot be renewed | spec `info.description` |
| Permissions | "The same permissions as the owning user", with no scoping. Whether a role change takes effect on an existing token is **not documented** (presumably yes, since permissions are checked against the user) | spec |
| User leaves | Suspended user: tokens stop working, and resume on restore if not expired. Deleted user: tokens are revoked | https://tailscale.com/docs/features/sharing/how-to/remove-team-members |
| Revocation | Keys page, or `DELETE /tailnet/{t}/keys/{id}` (scope `api_access_tokens`) | spec |
| Audit | "Create API key", "Revoke API key", "API key expired" | https://tailscale.com/kb/1203/audit-logging |
| Only it can | Create device invites and user invites | spec notes |

### 1.2 OAuth client (`tskey-client-…`), a trust credential

| Aspect | Fact | Source |
|---|---|---|
| Created | Console, Settings → Trust credentials. Or the API: `POST /tailnet/{t}/keys` with `keyType: "client"`, `scopes`, and `tags` (tags are mandatory when the scopes include `devices:core` or `auth_keys`). That needs scope `oauth_keys` | https://tailscale.com/docs/features/oauth-clients; spec |
| Who can create | Owner, Admin, IT admin, Network admin. Non-owner roles can only grant scopes and tags they hold themselves | https://tailscale.com/docs/features/oauth-clients |
| Lifetime | The client **never expires**. Its access tokens last **1 hour** (fixed) | spec; https://tailscale.com/kb/1215/oauth-clients |
| Token exchange | `POST https://api.tailscale.com/api/v2/oauth/token`, form-encoded `client_id` and `client_secret`. Optional `scope` and `tags` narrow the token. **Tested:** asking for `scope=all:read` returned exactly `all:read` | https://tailscale.com/kb/1215/oauth-clients |
| Ownership | Belongs to the tailnet. Keeps working if its creator leaves | https://tailscale.com/docs/features/oauth-clients |
| Revocation | Console, or `DELETE /keys/{id}`. Revoking also revokes every access token it issued | https://tailscale.com/docs/reference/trust-credentials |
| Edit | Scopes, tags and description can be updated (`PUT /keys/{id}`, scope `oauth_keys`). Updates are audit-logged | spec; https://tailscale.com/kb/1203/audit-logging |
| Audit | Client created, updated and revoked, plus **every** "Create OAuth access token" (the client ID is the actor) | https://tailscale.com/kb/1203/audit-logging |
| Cannot | Create device or user invites. Mint **untagged** auth keys. List other users' API tokens without `all`/`all:read` | spec notes |

### 1.3 Federated identity (workload identity federation)

| Aspect | Fact | Source |
|---|---|---|
| What | Exchange an OIDC JWT from a trusted issuer (GitHub Actions, AWS, Google Cloud, Azure, or any public OIDC issuer) for an API token. **No stored secret** | https://tailscale.com/docs/features/workload-identity-federation |
| Created | Console (Trust credentials → OpenID Connect: issuer, subject pattern, optional claim rules, scopes, tags). Or the API: `keyType: "federated"` with `issuer`, `subject`, `scopes`, `tags`. That needs scope `federated_keys` | same; spec |
| Exchange | `POST /api/v2/oauth/token-exchange`, form-encoded `client_id`, `jwt`. Token lifetime and narrowing are **not documented** | same |
| Status | Beta 2025-10-30, GA 2026-02-19 | https://tailscale.com/changelog |

### 1.4 Auth keys (`tskey-auth-…`)

These are not API credentials: they let a **device join** the tailnet. The skill mints them.

| Aspect | Fact | Source |
|---|---|---|
| Options | One-off or reusable, ephemeral, pre-approved, tagged, pre-signed (Tailnet Lock) | https://tailscale.com/docs/features/access-control/auth-keys |
| Expiry | 1–90 days (`expirySeconds`, default 90 days) | same; spec |
| Minted by OAuth | **Must be tagged.** The tags must be the client's own, or tags owned by them through `tagOwners` | spec `tags` field; https://tailscale.com/docs/features/oauth-clients |
| Revoke | `DELETE /keys/{id}` does **not** remove devices that already joined with the key | https://tailscale.com/docs/features/access-control/auth-keys |
| Tagged devices | "Tagged devices have key expiry disabled by default" | same |

### 1.5 Others

- **OAuth apps (alpha):** authorization-code grant for third-party apps. Scope `auth_keys:create:once`; each token mints one auth key. Not relevant to an admin tool. https://tailscale.com/docs/features/oauth-apps/device-provisioning
- **SCIM key:** used only by identity providers at `controlplane.tailscale.com/scim/v2/`. It cannot call the API. https://tailscale.com/docs/features/user-group-provisioning

## 2. Scope catalogue

Source: https://tailscale.com/docs/reference/trust-credentials ("Write scopes include everything in their read scope"), plus the spec's per-operation `OAuth Scope:` lines.

| Read | Write | Grants | Needs tags? |
|---|---|---|---|
| `all:read` | `all` | Everything, including future endpoints. `all` can mint credentials | `all`: yes |
| `policy_file:read` | `policy_file` | Read: `GET /acl`, `/acl/preview`, `/acl/validate`. Write adds `POST /acl` | no |
| `devices:core:read` | `devices:core` | List and get devices. Write: delete, authorize, expire, name, ip, key, tags | write: yes |
| `devices:routes:read` | `devices:routes` | `/device/{id}/routes` | no |
| `devices:posture_attributes:read` | `devices:posture_attributes` | Device attributes, batch attributes | no |
| `auth_keys:read` | `auth_keys` | Read, create and delete auth keys | write: yes |
| `oauth_keys:read` | `oauth_keys` | OAuth clients (**mints credentials**) | — |
| `federated_keys:read` | `federated_keys` | Federated identities (**mints credentials**) | — |
| `api_access_tokens:read` | `api_access_tokens` | Read and delete personal tokens (no create) | — |
| `dns:read` | `dns` | All DNS endpoints. `/dns/configuration` is unlisted; see api-surface §3 | — |
| `users:read` | `users` | Users, plus role, approve, suspend, restore, delete | — |
| `device_invites:read` | `device_invites` | Get and delete invites (create, resend and accept are user tokens only) | — |
| `webhooks:read` | `webhooks` | Webhooks CRUD, test, rotate | — |
| `logs:configuration:read` | — | Configuration audit logs | — |
| `logs:network:read` | `logs:network` | Network flow logs, plus the `networkFlowLoggingOn` setting | — |
| `log_streaming:read` | `log_streaming` | Stream config and status, AWS external ID | — |
| `account_settings:read` | `account_settings` | Contacts | — |
| `feature_settings:read` | `feature_settings` | `/settings`, posture integrations | — |
| `networking_settings:read` | `networking_settings` | The `httpsCertificates` setting (spec only) | — |
| `services:read` | `services` | Services (some operations also need `devices:core`) (spec only) | — |
| `oauth_apps:read` | `oauth_apps` | OAuth apps (spec only) | — |
| `tailnets:read` | `tailnets` | Tailnet creation API (alpha) | — |

Legacy scopes (`acl`, `devices`, `routes`, `logs:read`, `network-logs:read`) still work on clients created before 2024-11-14.

## 3. Tag rules that shape the design

1. **A client with `auth_keys` or `devices:core` must carry at least one tag.** Before that tag can be assigned to the client, it must exist in `tagOwners`. That is why setup step 1 adds `"tag:tailscale-admin": ["autogroup:admin"]` to the policy. **Tested:** the tag was in `tagOwners` before the client was created.
2. **The client can only mint auth keys for its own tags, or for tags those tags own.** For a router tag, the policy needs `"tag:<router>": ["tag:tailscale-admin"]` (alongside any human owners) *before* the key is minted. The skill's `policy_file` scope lets it add that line itself.
3. **Devices joined with a tagged key are owned by the tailnet** and have key expiry disabled by default.

## 4. Recommendation matrix

| Use | Credential | Scopes | Storage |
|---|---|---|---|
| **Interactive agent use (default)** | One OAuth client, tagged `tag:tailscale-admin` | `all:read`, `policy_file`, `auth_keys`, `devices:core`, `devices:routes`. Add more write scopes only when a command needs them. **Never `all`, `oauth_keys` or `federated_keys`** | HappySkills env model (below) |
| Research / read-only runs | **The same client**, with the token narrowed to `all:read` at exchange | — | same |
| Unattended automation on a server | A separate OAuth client per system, with the minimum scopes and its own tag | per job | That system's secret store |
| CI (GitHub Actions etc.) | **Federated identity**: no stored secret, trust tied to the repository and branch | per job | Nothing to store |
| Device and user invites | Personal API token (the only credential that can) | n/a | Out of scope for v1 |

**Storage (HappySkills env model):**
- `skill.json` declares `env.TAILSCALE_OAUTH_CLIENT_ID` and `env.TAILSCALE_OAUTH_CLIENT_SECRET`, both `required: true, secret: true`, with a `setupGuide` and a `verify` command.
- Install creates a git-ignored `secrets/tailscale-admin.env` (project install) or `~/.agents/secrets/tailscale-admin.env` (global install), and `skills-config.json` records it as `envFile`.
- Only the skill's scripts read the file. The agent checks presence, never the value.
- The 1-hour access token is held **in memory for one run** and never written to disk.
- On this VPS during development, the file is `./secrets/tailscale-admin.env` (mode 600, git-ignored).
