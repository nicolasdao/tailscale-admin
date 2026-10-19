# Tailscale policy file: mechanics the skill relies on

Research for the `tailscale-admin` skill, written 2026-10-19. The syntax reference is https://tailscale.com/docs/reference/syntax/policy-file, and API behaviour comes from the OpenAPI spec (see api-surface.md). All examples use **sample** data.

## 1. HuJSON

The policy file is HuJSON: JSON plus `//` and `/* */` comments and trailing commas. Comments are where admins record *why* a rule exists. **A plain JSON round-trip (parse → serialise) deletes every comment.** So:
- Always read with `GET /tailnet/{t}/acl` and `Accept: application/hujson`. Without that header the API returns plain JSON.
- Never build the file to POST from a parsed object. Edit the original text.

## 2. Sections

| Section | Shape | Skill relevance |
|---|---|---|
| `acls` | `[{action: "accept", src: [...], dst: ["host:port"]}]` | Legacy access rules. Still supported, and can coexist with `grants` |
| `grants` | `[{src: [...], dst: [...], ip: ["tcp:5432"], via?: [...], srcPosture?: [...], app?: {...}}]` | Newer access model. `via` routes traffic through specific routers or exit nodes. **The recipe appends to whichever section the policy already uses; it never converts one to the other** |
| `groups` | `{"group:name": ["user@domain", ...]}` | The access-rule source chosen for the recipe (`group:db-operators`). Created if missing |
| `tagOwners` | `{"tag:x": ["autogroup:admin", "tag:y", "user@…"]}` | Who may apply a tag. **The OAuth client's tag must own a tag before the client can mint auth keys for it** |
| `autoApprovers` | `{routes: {"cidr": [owners]}, exitNode: [owners]}` | Approves advertised subnet routes and exit nodes automatically when the advertising device matches |
| `ssh` | `[{action: "accept"/"check", src, dst, users}]` | Tailscale SSH. Not touched by the recipe |
| `tests` / `sshTests` | `[{src, accept: [...], deny: [...]}]` | Assertions checked on every save; a failing test rejects the write. The recipe could add one per router (a Phase 2 option) |
| `postures` | `{"posture:name": ["node:os == 'linux'", ...]}` | Device posture conditions referenced by `srcPosture` |
| `nodeAttrs` | `[{target: [...], attr: [...]}]` | Per-node feature attributes |
| `hosts`, `ipsets`, `derpMap`, others | — | Preserved byte-for-byte; never parsed for editing |

Auto-approval caveat (from the earlier research; **to verify** live in Phase 3): an approver applies when a route is advertised. A route already *pending* before the approver existed may need re-advertising, or an explicit `POST /device/{id}/routes`. The recipe therefore always checks and, if needed, approves explicitly in its `finish` stage.

## 3. Concurrency: ETag, If-Match, `ts-default`

- `GET /acl` returns an `ETag` header (quoted hex). **Tested:** present on a live response.
- `POST /acl` with `If-Match: "<etag>"` replaces the file **only if it is unchanged since that GET**. A mismatch returns **412**. Without `If-Match`, the last writer silently wins.
- `If-Match: "ts-default"` writes only over the untouched default policy of a brand-new tailnet.
- The skill always sends `If-Match`. On 412 it re-reads, re-applies its targeted edits to the fresh text, shows the new diff, and asks again. It never retries blindly.

Source: spec, `POST /tailnet/{tailnet}/acl` parameter `If-Match`.

## 4. Validate vs preview

| | `POST /acl/validate` | `POST /acl/preview?type=user\|ipport&previewFor=…` |
|---|---|---|
| Purpose | Check a candidate policy (object body), or run test cases against the current policy (array body) | Show which rules match a user or an ip:port under a candidate policy |
| Applies changes? | **No**: "neither of which modifies your current tailnet policy file" | **No**: "without saving the policy file to the server" |
| Result | **200 with an empty body = valid. 200 with a JSON body = invalid**, with the reason. The status alone is not enough | 200 with matches |
| Scope | `policy_file:read` | `policy_file:read` |

Sources: spec descriptions; the archived official doc `publicapi/tailnet.md` (tailscale/tailscale@041733d3d). The skill validates the exact edited HuJSON text before every write. The read-only test suite (spec §4.10) uses validate and preview because neither applies changes.

## 5. The safe write sequence

1. `GET /acl` (HuJSON) → text plus ETag.
2. Apply targeted, insert-only edits to the text (§6). If nothing is needed, report "already in place" and stop.
3. Show a unified diff of old vs new text.
4. `POST /acl/validate` with the new text. If the body is non-empty, show the reason and stop.
5. Apply only with the confirmation flag: `POST /acl` with the new text and `If-Match`.
6. If 412, go back to step 1.

## 6. Comment-preserving targeted edits: the prototype

**Approach chosen:**
- `jsonc-parser` (MIT, the parser behind VS Code) **only locates nodes and their byte offsets**.
- New entries are **inserted as new lines** after the last sibling, copying its indentation.
- A missing trailing comma is added after the previous sibling (HuJSON allows trailing commas).
- Appending a value to an existing inline array (`["a"]` → `["a", "b"]`) changes only that line, after its last element.
- Nothing is ever reformatted or deleted.

**Alternatives measured and rejected:**
- `jsonc-parser` `modify()` with formatting on: it re-indented whole sibling entries (`"tag:web": ["autogroup:admin"]` became four lines), and it moved a trailing `// web servers` comment onto the newly inserted entry.
- `modify()` with formatting off: no unrelated bytes changed, but new entries were squeezed onto existing lines (`…"],"tag:new": [...], // web servers`). That is unreadable, and the comment ends up after the wrong entry.
- Go `hujson`: `Value.Patch` (RFC 6902) keeps comments, but Tailscale recommends `Format()` afterwards, and `Format()` reformats the whole file ("the equivalent of go fmt"). Skipping it leaves unformatted inserts. Go is not installed on the target machines either.

**Worked example:**
- Input: `test/fixtures/policy/sample-grants.hujson`. It uses grants rather than acls, has no `groups` block, tabs, and line and block comments.
- Script: `scripts/research/policy-edit-proto.mjs`.

Five changes for a sample subnet router (`tag:example-router`, `10.60.0.0/16`, port 5432):

```diff
@@ -3,7 +3,8 @@
 	// Tags and who may apply them
 	"tagOwners": {
 		"tag:web":    ["autogroup:admin"], // web servers
-		"tag:bot":    ["autogroup:admin"],
+		"tag:bot":    ["autogroup:admin", "tag:tailscale-admin"],
+		"tag:example-router": ["autogroup:admin", "tag:tailscale-admin"],
 	},
 
 	/* Routes approved automatically
@@ -11,6 +12,7 @@
 	"autoApprovers": {
 		"routes": {
 			"10.40.0.0/16": ["tag:poc-router"], // PoC VPC
+			"10.60.0.0/16": ["tag:example-router"],
 		},
 	},
 
@@ -21,9 +23,13 @@
 			"dst": ["*"],
 			"ip":  ["*"],
 		},
+		{"src": ["group:db-operators"], "dst": ["10.60.0.0/16"], "ip": ["tcp:5432"]},
 	],
 
 	"ssh": [
 		{"action": "check", "src": ["autogroup:member"], "dst": ["autogroup:self"], "users": ["autogroup:nonroot"]},
 	],
+	"groups": {
+		"group:db-operators": ["user@example.com"],
+	},
 }
```

**Results:**
- The output parses with zero errors.
- Every comment (line, trailing and block) is where it was.
- The only modified existing line is `tag:bot`, where a value was appended inside its array.
- **Second run:** every step reports "already in place" and the output is byte-identical.

**Known limits to handle in Phase 3:**
- New top-level blocks are appended at the end of the file (here after `ssh`). That is valid but not where a human might put them.
- Duplicate detection for rules is exact-match on the parsed value. A rule that is equivalent but written differently would be added again; the diff preview makes that visible.
- A container written entirely on one line (`{"a": 1, "b": 2}`) gets its new member on the next line. That is valid and readable, but it changes the layout. The diff shows it.
- The editor refuses to touch `grants` rules that use `via`, or any structure it cannot classify, and asks a human instead (spec §4.9).
