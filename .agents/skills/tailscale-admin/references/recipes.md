# Recipe: subnet router

Makes a private network (e.g. an AWS VPC) reachable over the tailnet through a small router device that advertises its CIDR. There are two stages, both idempotent. A second run reports `already_in_place` for every step and mints no new key.

## Inputs

| Flag | Example | Notes |
|---|---|---|
| `--tag` | `tag:acme-router` | The router's identity. Owned by `autogroup:admin` (or `--tag-owner`) plus the automation tag |
| `--cidr` (repeatable) | `10.60.0.0/16` | Refused if it overlaps a route another device advertises or serves |
| `--port` (repeatable) | `5432` | Ports the operators may reach. `--proto` defaults to `tcp` |
| `--hostname` | `acme-prod-router` | The router's Tailscale hostname |
| `--group` | `group:db-operators` | The access-rule source. Default: config `operatorGroup` |
| `--member` (repeatable) | `alice@example.com` | Group members. Required only if the group does not exist yet |
| `--key-out` | `/tmp/acme-router.key` | Where the new auth key is written (mode 0600). Required |
| `--key-expiry` | `1d` | Default: config `keyExpiry`. Maximum 90d |
| `--reusable`, `--new-key`, `--skip-key` | | Opt-ins |

## Stage 1: `prepare` (before the router exists)

```bash
node "${CLAUDE_SKILL_DIR}/scripts/tsa.mjs" recipe subnet-router prepare \
  --tag tag:acme-router --cidr 10.60.0.0/16 --port 5432 \
  --hostname acme-prod-router --member alice@example.com --key-out /tmp/acme-router.key
```

1. Overlap check against every device's advertised and enabled routes.
2. **One** validated, `If-Match` policy write containing:
   - `tagOwners[tag]` ⊇ owners plus the automation tag
   - `autoApprovers.routes[cidr]` ⊇ tag
   - the group's members
   - the access rule (group → cidr:ports)
3. A tagged, pre-authorised, single-use auth key written to `--key-out`. **Skipped if** the router has already joined, or an active key for it exists. The description `subnet-router <hostname>` is how it is found again.

Show the user the `diff` and the key request, then re-run with `--apply` once they agree.

**Delivering the key:** pass the file to its consumer without printing it, then delete it:
- `aws ssm put-parameter --name /x/router-key --type SecureString --value "file:///tmp/acme-router.key"`
- or `pulumi config set --secret routerAuthKey < /tmp/acme-router.key`

On the router: `tailscale up --auth-key=file:<path> --hostname=<hostname> --advertise-routes=<cidr> --advertise-tags=<tag>`. The `file:` form keeps the key off the command line.

## Stage 2: `finish` (after the router joined)

```bash
node "${CLAUDE_SKILL_DIR}/scripts/tsa.mjs" recipe subnet-router finish --hostname acme-prod-router --cidr 10.60.0.0/16 [--revoke-key] --apply
```

1. Finds the device. If `hostname-1` style duplicates exist, it **refuses and lists them**. Delete the stale ones explicitly (`devices delete … --confirm …`), then re-run.
2. Ensures the CIDR is enabled. Usually it already is, through `autoApprovers`. Warns if the router does not advertise it.
3. Ensures device key expiry is disabled. Tagged devices usually have it off already.
4. With `--revoke-key`, revokes any still-active key for this router. Single-use keys are revoked automatically when used.
5. Reports the device, its routes and its expiry state.

**Verify from an operator machine:** `tailscale status --json`. The router's peer entry should list the CIDR under `PrimaryRoutes`, provided that machine accepts routes (`--accept-routes`).

## Stop and ask the user when

- `prepare` reports overlapping routes.
- The policy is refused by validation. Show `validation` verbatim.
- Every grant in the policy uses `via`: the editor refuses to add a plain rule there.
- `finish` lists duplicate devices.
