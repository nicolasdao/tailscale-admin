# Setup after install: connect the skill to your Tailscale account

The skill needs one **OAuth client**: a client ID and a client secret that Tailscale issues. Only a person can create it, in the Tailscale admin console, once. It takes about 5 minutes.

**For the agent:**
- Walk the user through this page in plain language, one step at a time, and wait for "done" before moving to the next step.
- **Never ask for the client ID or secret in the chat.** Never `cat`, `Read` or `echo` the secrets file. The user types the values into the file themselves.
- Show the user the real file path (see "Where the secrets go"), not a placeholder.

**Who can do this:** someone with the Owner, Admin, IT admin or Network admin role on the tailnet.

## What the install already did

Installing the skill created a **secrets file with two empty placeholders**, git-ignored so it can't be committed:

```
TAILSCALE_OAUTH_CLIENT_ID=
TAILSCALE_OAUTH_CLIENT_SECRET=
```

### Where the secrets go

| Install type | Secrets file (created for you) | Recorded in |
|---|---|---|
| Project (`npx happyskills install …`) | `<project>/secrets/tailscale-admin.env` | `<project>/skills-config.json`, key `envFile` |
| Global (`… install -g`) on macOS | `/Users/<you>/.agents/secrets/tailscale-admin.env` | `/Users/<you>/.agents/skills-config.json` |
| Global on Linux | `/home/<you>/.agents/secrets/tailscale-admin.env` | `/home/<you>/.agents/skills-config.json` |
| Global on Windows | `C:\Users\<you>\.agents\secrets\tailscale-admin.env` | `C:\Users\<you>\.agents\skills-config.json` |

To find the exact path in use, run from the project:

```bash
npx -y happyskills skills-config get nicolasdao/tailscale-admin --json
```

`data.envFile` is the file. `data.secretsPresent` says whether both values are filled in.

**Lock the file down** (macOS and Linux). Install creates it readable by other users on the machine:

```bash
chmod 600 <path-to>/tailscale-admin.env
```

`tsa auth check` warns until this is done. On Windows, the file sits in your user profile, which is private to you by default.

## Step 1: add the skill's tag to your policy

A client that creates auth keys or manages devices must carry a tag. A tag can only be assigned once it exists in `tagOwners`.

1. Open https://login.tailscale.com/admin/acls/file. If offered a choice of editors, use the **JSON editor**.
2. Search for `"tagOwners"`.
   - **If you find it**, add this line just after its opening `{`:
     ```
     "tag:tailscale-admin": ["autogroup:admin"],
     ```
   - **If it is not there**, put your cursor right after the very first `{` at the top of the file and paste:
     ```
     "tagOwners": {
         "tag:tailscale-admin": ["autogroup:admin"],
     },
     ```
3. Click **Save**. If an error appears, nothing was saved: fix the reported line first.

(To use a different tag name, also set the skill's `automationTag` config to match.)

## Step 2: create the OAuth client

1. Open https://login.tailscale.com/admin/settings/trust-credentials.
2. Click the button that creates a new credential (labelled like **"+ Credential"** or **"Generate"**). If asked for a type, choose **OAuth**.
3. **Description:** `tailscale-admin skill`
4. **Scopes:** tick only these and leave everything else unticked:

   | Scope | Tick |
   |---|---|
   | **All** | **Read** only (not Write) |
   | **Policy file** | **Write** |
   | **Auth keys** | **Write** |
   | **Devices → Core** | **Write** |
   | **Devices → Routes** | **Write** |

   Never tick **All → Write**, **OAuth keys** or **Federated keys**: those let the client create more credentials. Other write scopes (DNS, users, webhooks…) can be added later, on the same client, when you want those commands.
5. **Tags:** when asked (for Auth keys and Devices → Core), choose **`tag:tailscale-admin`**. If it is not in the list, step 1 did not save.
6. Click **Generate**. **Keep the page open:** the **Client secret** (starts with `tskey-client-`) is shown only once.

## Step 3: put the two values in the secrets file

Open the secrets file from "Where the secrets go" in any editor. In Claude Code you can type `! nano <path>`, or `! notepad <path>` on Windows. Fill in the two lines with no spaces and no quotes:

```
TAILSCALE_OAUTH_CLIENT_ID=k123abc...
TAILSCALE_OAUTH_CLIENT_SECRET=tskey-client-k123abc-...
```

Save. (`nano`: Ctrl+O, Enter, Ctrl+X.)

## Step 4: verify

Run, from anywhere inside the project (the path is the skill's own folder):

```bash
node "${CLAUDE_SKILL_DIR}/scripts/tsa.mjs" auth check
```

(Without `CLAUDE_SKILL_DIR`, use the install path, e.g. `.agents/skills/tailscale-admin/scripts/tsa.mjs`, or `~/.agents/skills/…` for a global install. The `verify` command in `skill.json` is relative to that skill folder.)

| Result | Meaning |
|---|---|
| `"ok": true` with `grantedScopes` | Connected. The setup is complete |
| `credentials_missing` | A value is empty. It names the file and the variable |
| `auth_failed` | A typo in the ID or secret, or the client was revoked. Re-copy both values |
| `"warning": "...readable by other users..."` | Run the `chmod 600` shown |

## Using a different location for the secrets (optional)

The default is fine for most people. The alternatives:

**A. Another file inside the same project.** Edit `envFile` in the project's `skills-config.json`. It is the one field the CLI cannot set:

```json
{ "nicolasdao/tailscale-admin": { "envFile": "./config/tailscale-admin.env" } }
```

- The path must be **relative and inside the project**. Absolute paths and `../` paths are rejected, so the setup works on every machine.
- Move the two values into the new file, make sure it is git-ignored, and `chmod 600` it.
- Check with `npx -y happyskills skills-config validate --json`.
- For a global install, the same applies to `~/.agents/skills-config.json`, with paths inside `~/.agents`.

**B. One credential shared by all your projects.** Install the skill **globally** (`-g`) and fill in `~/.agents/secrets/tailscale-admin.env` once. Any project without its own `envFile` entry uses the global file.
- A project install of the skill creates its own empty file, and that one takes priority. Either don't also install per project, or remove the `nicolasdao/tailscale-admin` entry from that project's `skills-config.json`.

**C. Environment variables instead of a file.** If `TAILSCALE_OAUTH_CLIENT_ID` and `TAILSCALE_OAUTH_CLIENT_SECRET` are set in the environment (e.g. by a password-manager CLI), they take precedence over any file.
- Avoid putting them in a shell profile that every process loads: that hands an admin credential to every program you run.

## Rotating or revoking

1. Revoke the client on the Trust credentials page. This also kills every access token it issued.
2. Create a new one (step 2).
3. Replace both values in the secrets file.
4. Run `auth check`.
