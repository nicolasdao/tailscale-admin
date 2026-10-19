#!/usr/bin/env node
// Generates the per-operation section of docs/research/api-surface.md from the
// Tailscale OpenAPI document, merged with the research overlay below.
// Usage: node gen-api-surface.mjs <openapi.json> > section.md
// (Convert the YAML to JSON first; this script has no YAML dependency.)
import fs from 'node:fs'

const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const METHODS = ['get', 'post', 'put', 'patch', 'delete']
const DOCS = 'https://tailscale.com/api'

// Research findings layered over the spec. Keys are "METHOD path".
// scope: replaces a missing "OAuth Scope:" line. gate: plan or release gating. note: anything else.
const OVERLAY = {
	'GET /tailnet/{tailnet}/dns/nameservers': { scope: '`dns:read` (trust-credentials page)' },
	'GET /tailnet/{tailnet}/dns/preferences': { scope: '`dns:read` (trust-credentials page). Tested: 200 with `all:read`' },
	'POST /tailnet/{tailnet}/dns/preferences': { scope: '`dns` (trust-credentials page)' },
	'GET /tailnet/{tailnet}/dns/searchpaths': { scope: '`dns:read` (trust-credentials page)' },
	'GET /tailnet/{tailnet}/dns/split-dns': { scope: '`dns:read` (trust-credentials page)' },
	'PATCH /tailnet/{tailnet}/dns/split-dns': { scope: '`dns` (trust-credentials page)' },
	'GET /tailnet/{tailnet}/dns/configuration': { scope: 'unknown, not on the trust-credentials page; tested: 200 with `all:read` (narrower `dns:read` not yet tested)' },
	'POST /tailnet/{tailnet}/dns/configuration': { scope: 'unknown, presumably `dns`; not tested (write)' },
	'POST /tailnet/{tailnet}/acl/preview': { scope: '`policy_file:read` (trust-credentials page)' },
	'POST /device/{deviceId}/device-invites': { scope: 'none: user-owned API tokens only, refused for OAuth/federated tokens (spec note)' },
	'POST /device-invites/{deviceInviteId}/resend': { scope: 'none: user-owned API tokens only (spec note)' },
	'POST /device-invites/-/accept': { scope: 'none: user-owned API tokens only (spec note)' },
	'GET /tailnet/{tailnet}/user-invites': { scope: 'unknown, not on the trust-credentials page; tested: 200 (body `null`) with an `all:read` OAuth token' },
	'POST /tailnet/{tailnet}/user-invites': { scope: 'none: "Only permitted for user-owned keys" (spec note)' },
	'GET /user-invites/{userInviteId}': { scope: 'unknown; presumably readable like the list (untested)' },
	'DELETE /user-invites/{userInviteId}': { scope: 'unknown, not on the trust-credentials page (untested)' },
	'POST /user-invites/{userInviteId}/resend': { scope: 'unknown, not on the trust-credentials page (untested)' },
	'PUT /tailnet/{tailnet}/logging/{logType}/stream': { gate: 'Premium/Enterprise (kb/1255). Tested: GET returns 403 "feature not available on current billing plan" on a lower plan' },
	'GET /tailnet/{tailnet}/logging/{logType}/stream': { gate: 'Premium/Enterprise (kb/1255); tested 403 on a lower plan' },
	'GET /tailnet/{tailnet}/logging/{logType}/stream/status': { gate: 'Premium/Enterprise (kb/1255)' },
	'DELETE /tailnet/{tailnet}/logging/{logType}/stream': { gate: 'Premium/Enterprise (kb/1255)' },
	'GET /tailnet/{tailnet}/logging/network': { gate: 'Premium/Enterprise, 30-day retention (kb/1219)' },
	'GET /tailnet/{tailnet}/logging/configuration': { gate: 'All plans, 90-day retention (kb/1203)' },
	'POST /tailnet/{tailnet}/posture/integrations': { gate: 'MDM/EDR integrations need Standard or above (kb/1288)' },
	'POST /device/{deviceId}/attributes/{attributeKey}': { gate: 'Custom posture attributes need Premium/Enterprise (kb/1288)' },
	'POST /device/{deviceId}/routes': { note: 'Replaces the whole enabled list: read, merge, then write' },
	'POST /device/{deviceId}/tags': { note: 'Replaces the whole tag list: read, merge, then write' },
	'POST /tailnet/{tailnet}/acl': { note: 'Always send `If-Match` with the ETag from a HuJSON GET; 412 on mismatch' },
	'POST /tailnet/{tailnet}/acl/validate': { note: '200 with an empty body means pass; 200 with a JSON body means failure. Never applies changes' },
	'POST /tailnet/{tailnet}/dns/nameservers': { scope: '`dns` (trust-credentials page)', note: 'Replaces the list' },
	'POST /tailnet/{tailnet}/dns/searchpaths': { scope: '`dns` (trust-credentials page)', note: 'Replaces the list' },
	'PUT /tailnet/{tailnet}/dns/split-dns': { scope: '`dns` (trust-credentials page)', note: 'Replaces the whole map; PATCH merges' },
}

// Idempotency from method plus known replace-semantics.
const REPLACES = /\/(routes|tags|name|ip|key|authorized|role|nameservers|searchpaths|preferences|configuration|approved|acl|stream)$|split-dns$|\/settings$|\/contacts\/\{contactType\}$|keys\/\{keyId\}$|oauth-apps\/\{appId\}$|services\/\{serviceName\}$|\/attributes\/\{attributeKey\}$|device-attributes$|webhooks\/\{endpointId\}$|integrations\/\{id\}$/
function idempotency(m, p) {
	if (m === 'get') return 'safe'
	if (m === 'delete') return 'idempotent (repeat returns 404)'
	if (p.endsWith('/acl/validate') || p.endsWith('/acl/preview')) return 'safe (no change applied)'
	if (/\/(resend|test|rotate|expire|accept|suspend|restore|approve|delete)$/.test(p)) return 'not idempotent (action)'
	if (m === 'put' || m === 'patch' || REPLACES.test(p)) return 'idempotent (sets state)'
	return 'not idempotent (creates)'
}

const deref = (o) => {
	let cur = o
	while (cur && cur.$ref) cur = cur.$ref.split('/').slice(1).reduce((a, k) => a[k], spec)
	return cur
}
const fields = (schema) => {
	const s = deref(schema)
	if (!s) return '-'
	if (s.type === 'array') return `array of ${fields(s.items)}`
	const props = s.properties || (s.allOf || []).reduce((a, x) => ({ ...a, ...(deref(x).properties || {}) }), {})
	const keys = Object.keys(props)
	return keys.length ? `{${keys.join(', ')}}` : (s.type || '-')
}
const scopeOf = (desc = '') => [...desc.matchAll(/OAuth Scope[s]?:\s*([^\n]+)/g)].map(x => x[1].trim()).join(' / ')
const params = (pathItem, op) => [...(pathItem.parameters || []), ...(op.parameters || [])]
	.map(deref).filter(x => x && x.in !== 'path' && x.in !== 'header').map(x => `${x.name}${x.required ? '*' : ''}`).join(', ') || '-'
const anchor = (tag, m, p) => `${DOCS}#tag/${tag.toLowerCase()}/${m}${p}`

const byTag = {}
for (const [p, item] of Object.entries(spec.paths)) {
	for (const m of METHODS) {
		const op = item[m]
		if (!op) continue
		const tag = (op.tags || ['Untagged'])[0]
		;(byTag[tag] ||= []).push({ m, p, op, item })
	}
}

let total = 0
const out = []
for (const tag of Object.keys(byTag).sort()) {
	out.push(`### ${tag} (${byTag[tag].length})\n`)
	for (const { m, p, op, item } of byTag[tag]) {
		total++
		const key = `${m.toUpperCase()} ${p}`
		const ov = OVERLAY[key] || {}
		const badges = (op['x-badges'] || []).map(b => b.name).join(', ')
		const body = op.requestBody ? fields(Object.values(deref(op.requestBody).content || {})[0]?.schema) : '-'
		const ok = Object.entries(op.responses || {}).find(([c]) => c.startsWith('2'))
		const resp = ok ? (deref(ok[1]).content ? fields(Object.values(deref(ok[1]).content)[0].schema) : `${ok[0]}, no body`) : '-'
		const errors = Object.keys(op.responses || {}).filter(c => !c.startsWith('2')).join(', ') || '-'
		const scope = scopeOf(op.description) || ov.scope || 'NOT STATED'
		out.push(`#### \`${key}\`${badges ? ` [${badges}]` : ''}\n`)
		out.push(`- **Purpose:** ${op.summary}`)
		out.push(`- **Query params:** ${params(item, op)}`)
		out.push(`- **Request body:** ${body}`)
		out.push(`- **Response:** ${resp}`)
		out.push(`- **Scope:** ${scope}${scopeOf(op.description) && ov.scope ? ` (research: ${ov.scope})` : ''}`)
		out.push(`- **Idempotency:** ${idempotency(m, p)}`)
		out.push(`- **Pagination:** ${/cursor/.test(params(item, op)) ? 'cursor + limit' : 'none (full result)'}`)
		out.push(`- **Errors:** ${errors}`)
		out.push(`- **Gating:** ${ov.gate || (badges ? `${badges} (not a stable interface)` : 'none stated')}`)
		if (ov.note) out.push(`- **Note:** ${ov.note}`)
		out.push(`- **Docs:** ${anchor(tag, m, p)}\n`)
	}
}
process.stdout.write(`<!-- generated by scripts/research/gen-api-surface.mjs: ${total} operations -->\n\n` + out.join('\n'))
