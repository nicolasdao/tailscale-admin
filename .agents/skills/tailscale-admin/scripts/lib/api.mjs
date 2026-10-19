// HTTP client for the Tailscale API v2: OAuth client-credentials exchange with per-call
// scope narrowing, an in-memory token cache (never on disk), JSON error surfacing and
// retry with backoff on 429/5xx.
import { loadCredentials } from './env.mjs'
import { TsaError } from './out.mjs'

export const BASE = process.env.TAILSCALE_API_BASE || 'https://api.tailscale.com/api/v2'
const tokens = new Map()

async function token(scopes) {
	const key = [...scopes].sort().join(' ')
	if (tokens.has(key)) return tokens.get(key)
	const { values, source, missing } = loadCredentials()
	if (missing.length) {
		throw new TsaError('credentials_missing', `Missing ${missing.join(' and ')}. Set them in ${source} (see references/setup.md).`, { envFile: source, missing })
	}
	const form = new URLSearchParams({
		client_id: values.TAILSCALE_OAUTH_CLIENT_ID,
		client_secret: values.TAILSCALE_OAUTH_CLIENT_SECRET,
	})
	if (key) form.set('scope', key)
	const res = await fetch(`${BASE}/oauth/token`, { method: 'POST', body: form })
	const body = await res.json().catch(() => ({}))
	if (!res.ok || !body.access_token) {
		throw new TsaError('auth_failed', `OAuth token exchange failed (HTTP ${res.status}): ${body.message || body.error_description || body.error || 'no detail'}. Check the client ID and secret, and that the client has the scopes: ${key || '(all of its own)'}.`, { httpStatus: res.status, requestedScopes: key })
	}
	const t = { access: body.access_token, scope: body.scope }
	tokens.set(key, t)
	return t
}

export async function grantedScopes(scopes = []) {
	return (await token(scopes)).scope
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// request('GET', '/tailnet/-/devices', { scopes: ['devices:core:read'], query, body, accept, contentType, headers })
// Returns { status, headers, body, text }. Throws TsaError on non-2xx.
export async function request(method, path, opts = {}) {
	const { scopes = [], query, body, accept = 'application/json', contentType, headers = {}, okStatuses = [] } = opts
	const t = await token(scopes)
	const url = new URL(BASE + path)
	for (const [k, v] of Object.entries(query || {})) {
		for (const item of [].concat(v)) if (item !== undefined && item !== null) url.searchParams.append(k, String(item))
	}
	const h = { Authorization: `Bearer ${t.access}`, Accept: accept, ...headers }
	let payload
	if (body !== undefined) {
		payload = typeof body === 'string' ? body : JSON.stringify(body)
		h['Content-Type'] = contentType || (typeof body === 'string' ? 'application/hujson' : 'application/json')
	}
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(url, { method, headers: h, body: payload })
		const text = await res.text()
		if ((res.status === 429 || res.status >= 500) && attempt < 4) {
			const ra = Number(res.headers.get('retry-after'))
			await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(8000, 500 * 2 ** attempt) + Math.random() * 250)
			continue
		}
		let json
		try { json = text ? JSON.parse(text) : null } catch { json = undefined }
		if (!res.ok && !okStatuses.includes(res.status)) {
			const msg = json?.message || text.slice(0, 300) || res.statusText
			throw new TsaError('api_error', `${method} ${path} → HTTP ${res.status}: ${msg}`, { httpStatus: res.status, method, path })
		}
		return { status: res.status, headers: res.headers, body: json, text }
	}
}
