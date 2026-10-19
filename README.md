# tailscale-admin

An agent skill (Claude Code, Codex and other runtimes that read `SKILL.md`) for administering a **Tailscale tailnet through the official API v2**. Agents can do the admin-console work themselves (policy edits, auth keys, route approval, device settings) instead of handing a human a checklist.

- **Comment-preserving policy edits.**
  - Targeted, insert-only changes to the HuJSON policy file: tag owners, auto-approvers, groups, access rules.
  - Every comment and unrelated byte is kept.
  - Each change is validated by Tailscale and written with `If-Match`, so a concurrent change is never overwritten.
  - Whole-file replacement is deliberately not offered.
- **Safe by default.**
  - Every write prints a plan (with a unified diff for policy changes) and changes nothing without `--apply`.
  - Destructive operations need `--confirm <exact target>`.
  - Re-running a write that is already satisfied reports `already_in_place`.
- **Least privilege.**
  - One OAuth client with scopes chosen by you.
  - Each command requests only the scopes it needs for that call.
  - Tokens live in memory for one run.
  - New auth keys are written to a 0600 file, never printed.
- **The whole API.**
  - Curated commands for common tasks.
  - `tsa api <METHOD> <path>` reaches every operation in the official OpenAPI document, under the same safety gate.
- **Subnet-router recipe:** `prepare` (policy plus a tagged, pre-approved auth key) and `finish` (route, key expiry, key revocation), end to end and idempotent.
- **Self-audit:** `tsa self-audit` diffs the live OpenAPI document against the skill's bundled index, so API changes are caught.

## Requirements

- Node.js 18 or later. No `npm install`: the two small dependencies (`jsonc-parser`, `js-yaml`, both MIT) are bundled.
- A Tailscale OAuth client. Creating it takes about 5 minutes in the admin console; see [setup](.agents/skills/tailscale-admin/references/setup.md).

## Install

Through [HappySkills](https://happyskills.ai) (once published):

```bash
npx -y happyskills install nicolasdao/tailscale-admin
```

Or copy `.agents/skills/tailscale-admin/` into your agent's skills folder.

## Usage

Ask your agent things like "set up a subnet router for 10.60.0.0/16", "approve the route on my router", "create a Tailscale auth key for tag:ci" or "add a tag owner". Or run the script directly:

```bash
node .agents/skills/tailscale-admin/scripts/tsa.mjs help
node .agents/skills/tailscale-admin/scripts/tsa.mjs policy get
node .agents/skills/tailscale-admin/scripts/tsa.mjs routes approve --device my-router --cidr 10.60.0.0/16          # plan
node .agents/skills/tailscale-admin/scripts/tsa.mjs routes approve --device my-router --cidr 10.60.0.0/16 --apply  # do it
```

See [SKILL.md](.agents/skills/tailscale-admin/SKILL.md) and the [command reference](.agents/skills/tailscale-admin/references/commands.md).

## Development

```bash
node --test test/                                                     # offline policy-editor tests
node .agents/skills/tailscale-admin/scripts/test-live-readonly.mjs    # read-only live tests (needs credentials)
node .agents/skills/tailscale-admin/scripts/tsa.mjs self-audit        # API drift check
```

Research and design notes are in [`docs/`](docs/).
