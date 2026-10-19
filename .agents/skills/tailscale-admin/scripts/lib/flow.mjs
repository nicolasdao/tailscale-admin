// Shared building blocks for write commands: the policy write sequence, device lookup,
// CIDR overlap and expiry parsing.
import { request } from './api.mjs'
import { STATUS, TsaError } from './out.mjs'
import { PolicyEditor } from './policy.mjs'

export const tn = (opts) => encodeURIComponent(opts.tailnet || '-')

// ---------- policy ----------

export async function readPolicy(opts, scopes = ['policy_file:read']) {
	const r = await request('GET', `/tailnet/${tn(opts)}/acl`, { scopes, accept: 'application/hujson' })
	return { text: r.text, etag: r.headers.get('etag') }
}

// Validate candidate HuJSON. The API returns 200 with an EMPTY body when valid, and 200 with
// a JSON body describing the problem when invalid: the status code alone means nothing.
export async function validatePolicy(opts, text, scopes = ['policy_file:read']) {
	const r = await request('POST', `/tailnet/${tn(opts)}/acl/validate`, { scopes, body: text, contentType: 'application/hujson' })
	const empty = !r.text.trim() || r.text.trim() === 'null' || r.text.trim() === '{}'
	return empty ? { valid: true } : { valid: false, detail: r.body ?? r.text }
}

// GET (HuJSON + ETag) → edit → guard → diff → validate → POST with If-Match (only with --apply).
// `edit(editor)` performs the ensure* calls; `touched` lists the top-level sections it may change.
export async function policyWrite(opts, edit, touched) {
	const scopes = opts.apply ? ['policy_file'] : ['policy_file:read']
	const { text, etag } = await readPolicy(opts, scopes)
	const ed = new PolicyEditor(text)
	edit(ed)
	if (!ed.changed) return { status: STATUS.inPlace, changes: [] }
	ed.verify(touched)
	const diff = ed.diff()
	const validation = await validatePolicy(opts, ed.text, scopes)
	if (!validation.valid) {
		return { status: STATUS.refused, reason: 'Tailscale rejected the edited policy; nothing was written.', validation: validation.detail, changes: ed.changes, diff }
	}
	if (!opts.apply) return { status: STATUS.planned, changes: ed.changes, diff, validated: true }
	const ifMatch = opts.ifMatch || etag
	if (!ifMatch) throw new TsaError('no_etag', 'The policy GET returned no ETag; refusing to write without If-Match.')
	const r = await request('POST', `/tailnet/${tn(opts)}/acl`, {
		scopes, body: ed.text, contentType: 'application/hujson', accept: 'application/hujson',
		headers: { 'If-Match': ifMatch }, okStatuses: [412],
	})
	if (r.status === 412) {
		return { status: STATUS.refused, reason: 'The policy file changed since it was read (ETag mismatch, HTTP 412). Nothing was written. Re-run to plan against the current version.', changes: ed.changes, diff }
	}
	return { status: STATUS.applied, changes: ed.changes, diff, etag: r.headers.get('etag') }
}

// ---------- devices ----------

const looksLikeId = (s) => /^\d{6,}$/.test(s) || /^n[A-Za-z0-9]{6,}CNTRL$/.test(s)

export async function listDevices(opts, scopes = ['devices:core:read'], query = {}) {
	const r = await request('GET', `/tailnet/${tn(opts)}/devices`, { scopes, query: { fields: 'all', ...query } })
	return r.body.devices || []
}

// Resolve --device (an ID or an exact hostname) to exactly one device, or refuse.
export async function resolveDevice(opts, ref, scopes = ['devices:core:read']) {
	if (!ref) throw new TsaError('usage', 'Missing --device <id or hostname>.')
	if (looksLikeId(ref)) {
		const r = await request('GET', `/device/${encodeURIComponent(ref)}`, { scopes, query: { fields: 'all' } })
		return r.body
	}
	const all = await listDevices(opts, scopes)
	const exact = all.filter(d => d.hostname === ref || d.name === ref || d.name?.split('.')[0] === ref)
	if (exact.length === 1) return exact[0]
	const near = all.filter(d => d.hostname?.startsWith(ref)).map(brief)
	if (!exact.length) throw new TsaError('device_not_found', `No device with hostname "${ref}".`, { similar: near })
	throw new TsaError('device_ambiguous', `${exact.length} devices match "${ref}". Pass the device ID instead.`, { matches: exact.map(brief) })
}

export const brief = (d) => ({
	id: d.id, nodeId: d.nodeId, hostname: d.hostname, name: d.name, tags: d.tags || [], user: d.user,
	os: d.os, connected: d.connectedToControl, lastSeen: d.lastSeen,
	keyExpiryDisabled: d.keyExpiryDisabled, expires: d.expires,
	advertisedRoutes: d.advertisedRoutes, enabledRoutes: d.enabledRoutes,
})

// ---------- CIDR ----------

function v4(cidr) {
	const m = String(cidr).match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)(?:\/(\d+))?$/)
	if (!m) return null
	const ip = ((+m[1] << 24) >>> 0) + (+m[2] << 16) + (+m[3] << 8) + +m[4]
	const bits = m[5] === undefined ? 32 : +m[5]
	const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
	return { start: (ip & mask) >>> 0, end: ((ip & mask) | (~mask >>> 0)) >>> 0 }
}

export function overlaps(a, b) {
	const x = v4(a), y = v4(b)
	if (!x || !y) return a === b
	return x.start <= y.end && y.start <= x.end
}

export function assertCidr(c) {
	if (!/^[0-9a-fA-F:.]+\/\d{1,3}$/.test(c)) throw new TsaError('usage', `"${c}" is not a CIDR (expected e.g. 10.60.0.0/16).`)
	return c
}

// ---------- misc ----------

export function parseExpiry(s, maxDays = 90) {
	const m = String(s).match(/^(\d+)([smhd])$/)
	if (!m) throw new TsaError('usage', `Expiry "${s}" must look like 30m, 12h or 7d.`)
	const secs = +m[1] * { s: 1, m: 60, h: 3600, d: 86400 }[m[2]]
	if (secs > maxDays * 86400) throw new TsaError('usage', `Expiry ${s} exceeds the ${maxDays}-day maximum.`)
	return secs
}

export const keyDescription = (s) => String(s).replace(/[^A-Za-z0-9 -]/g, '-').slice(0, 50)

export const isActiveKey = (k) => !k.revoked && (!k.expires || new Date(k.expires) > new Date()) && !k.invalid
