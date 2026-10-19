# Tailscale admin tooling: ecosystem check

Research for the `tailscale-admin` skill. Checked 2026-10-19 against GitHub releases (`gh`) and vendor docs.

## 1. Tools

| Tool | Official? | Latest release | Last commit | Policy writes | Keys / routes / key expiry / validate |
|---|---|---|---|---|---|
| [tailscale/terraform-provider-tailscale](https://github.com/tailscale/terraform-provider-tailscale/releases) | Yes | v0.29.2, 2026-05-26 | 2026-10-15 | **Whole file.** `tailscale_acl` "will completely overwrite existing policy file contents" ([docs](https://github.com/tailscale/terraform-provider-tailscale/blob/main/docs/resources/acl.md)) | `tailscale_tailnet_key`, `device_subnet_routes`, `device_key`, `device_tags`. No separate validate step |
| [pulumi/pulumi-tailscale](https://github.com/pulumi/pulumi-tailscale/releases) | Pulumi (wraps the Terraform provider v0.29.2) | v0.29.2, 2026-10-13 | 2026-10-16 | Whole file | As Terraform |
| [tailscale/gitops-acl-action](https://github.com/tailscale/gitops-acl-action/releases) | Yes | v1.5.2, 2026-04-27 | 2026-04-24 | **Whole file from git.** Detects drift through a cached ETag ([gitops-pusher](https://github.com/tailscale/tailscale/blob/main/cmd/gitops-pusher/gitops-pusher.go)) | Policy only, plus `test` |
| [tailscale/tailscale-skill](https://github.com/tailscale/tailscale-skill/releases) | Yes, public alpha, "not yet supported" | 1.0.0-alpha-1, 2026-07-10 | 2026-07-10 | None: reference markdown only, no code | n/a |
| [jaxxstorm/tscli](https://github.com/jaxxstorm/tscli/releases) | Community | v0.10.0, 2026-08-25 | 2026-10-10 | **Whole file** (`set policy --file`, optional `--if-match`) | Keys, routes, device expiry, policy validate and preview |
| [YawLabs/tailscale-mcp](https://github.com/YawLabs/tailscale-mcp/releases) | Community | v0.23.0, 2026-10-09 | 2026-10-15 | **Whole file.** `tailscale_update_acl` takes the full text and needs an ETag. The model is *told* to keep comments; no code enforces it | Keys, routes, key expiry, validate, preview |
| Other MCP servers: HexSleeves, tailscale-mcp/tailscale-mcp, jaxxstorm/tailscale-mcp, Groupthink-dev | Community | 2026 releases | — | All whole file (most with `If-Match`) | Varies |

Corrections to the earlier survey:
- The quote "does not authenticate to your tailnet", attributed to `tailscale-skill`, does not appear in that repository. Its README calls it reference material.
- The claim that Tailscale lists tscli as a community project could not be verified: the community page renders with JavaScript.

## 2. Libraries

| Library | Version | Relevant behaviour |
|---|---|---|
| [tailscale-client-go-v2](https://github.com/tailscale/tailscale-client-go-v2) (`tailscale.com/client/tailscale/v2`) | v2.12.0, 2026-10-09 | `PolicyFile().Raw()` returns HuJSON plus ETag. `Set(string, etag)` sends `If-Match`. **No partial-edit helper.** Lags the spec: calls `/vip-services`, and ignores the List tailnets cursor |
| [tailscale/hujson](https://github.com/tailscale/hujson) | untagged, last commit 2026-07-27, Go 1.26 | `Parse`, `Value.Patch` (RFC 6902, keeps comments, "does not format the value"), `Pack`, `Format`. **`Format` reformats the whole file** ("the equivalent of `go fmt`… output may change over time") |
| [jsonc-parser](https://www.npmjs.com/package/jsonc-parser) (npm, MIT, from VS Code) | 3.3.1 (2024-06-24); 4.0.0-next.2 pre-release | `parseTree`, `findNodeAtLocation`, `modify` + `applyEdits`. `modify` with formatting **re-indents the enclosing container**; see policy-file.md §6 |

## 3. Anything new or missed

- **No official Tailscale admin CLI.** The `tailscale` GitHub org has nothing beyond the client libraries and the GitOps action. The changelog adds only local-client CLI commands.
- **Aperture** (GA 2026-08-26) announced "Tailscale MCP endpoints" for agents to add nodes and SSH to them. It covers no policy, keys or routes administration. https://tailscale.com/blog/aperture-ga
- **No official, maintained tool edits only part of the policy while keeping its comments.** The spec's stop-and-ask condition (§4.3) does not trigger.

## 4. Build vs adopt

**Build.** Every existing writer replaces the whole policy file, which conflicts with the other subnet routers that share it. The Go client and tscli also lag the spec in places. A small, dependency-free Node layer can call the API straight from the spec and add the one missing piece: targeted, comment-preserving policy edits.

**Reuse:**
- `jsonc-parser`, bundled inside the skill (MIT), for locating nodes.
- The official OpenAPI document as the source of truth.
- `gitops-acl-action`'s ETag drift idea.

**Point users to Terraform or the GitOps action** if they want whole-file ownership of their policy. That is a different, legitimate model.
