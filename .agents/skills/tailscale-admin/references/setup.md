# Setup: create the OAuth client (one time, about 5 minutes)

The skill authenticates with one Tailscale **OAuth client** (a trust credential). Creating it needs a human in the admin console, once. Walk the user through these steps. **Never ask them to paste the secret into the chat.**

Who can do it: an Owner, Admin, IT admin or Network admin of the tailnet.

## Step 1: add the skill's tag to the policy

A client that creates auth keys or manages devices must carry a tag. A tag can only be assigned once it exists in `tagOwners`.

1. Open https://login.tailscale.com/admin/acls/file and use the JSON editor.
2. Find the `"tagOwners": {` block and add this line inside it:
   ```
   "tag:tailscale-admin": ["autogroup:admin"],
   ```
   If there is no `tagOwners` block, add one at the top level:
   ```
   "tagOwners": {
       "tag:tailscale-admin": ["autogroup:admin"],
   },
   ```
3. Save. If the console shows an error, fix that first.

(To use a different tag, set the skill's `automationTag` config to match.)

## Step 2: create the OAuth client

1. Open https://login.tailscale.com/admin/settings/trust-credentials and create a new credential of type **OAuth**.
2. Description: `tailscale-admin skill`.
3. Scopes. Tick only these:

   | Scope | Access |
   |---|---|
   | All | **Read** |
   | Policy file | **Write** |
   | Auth keys | **Write** |
   | Devices → Core | **Write** |
   | Devices → Routes | **Write** |

   Never grant `all` (write), `oauth_keys` or `federated_keys`: those let the client mint further credentials. Add other write scopes (DNS, users, webhooks…) only when the user wants those commands.
4. Tag: `tag:tailscale-admin`, wherever the form asks.
5. Generate. The **client secret** (`tskey-client-…`) is shown only once.

## Step 3: store the two values

Run `npx -y happyskills skills-config get nicolasdao/tailscale-admin --json` to find the `envFile`:
- project install: `<project>/secrets/tailscale-admin.env`
- global install: `~/.agents/secrets/tailscale-admin.env` (Windows: `C:\Users\<you>\.agents\secrets\tailscale-admin.env`)

The user edits that file **themselves**, for example with `! nano <envFile>` in Claude Code:

```
TAILSCALE_OAUTH_CLIENT_ID=<client id>
TAILSCALE_OAUTH_CLIENT_SECRET=tskey-client-<...>
```

The file must stay git-ignored (install adds `secrets/*.env` to `.gitignore`), with mode 600 on macOS and Linux.

## Step 4: verify

```bash
node "${CLAUDE_SKILL_DIR}/scripts/tsa.mjs" auth check
```

Success shows `"ok": true` and the granted scopes. `auth_failed` means a wrong ID or secret, or a revoked client. `credentials_missing` names the file and the missing variable.

## Rotating or revoking

Revoke the client on the Trust credentials page. This also revokes every access token it issued. Then repeat step 2 and replace both values in the env file.
