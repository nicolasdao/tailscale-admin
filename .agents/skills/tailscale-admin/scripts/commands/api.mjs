// api: generic access to every operation in the bundled OpenAPI index, under the same
// safety gate as curated commands (GET runs; anything else plans unless --apply;
// DELETE also needs --confirm <path>).
import fs from 'node:fs'
import { request } from '../lib/api.mjs'
import { confirmTarget, list } from '../lib/args.mjs'
import { STATUS, TsaError } from '../lib/out.mjs'
import { loadIndex, matchOperation } from '../lib/spec.mjs'

export async function run(_group, [method, apiPath], flags) {
	const index = loadIndex()
	if (method === 'list') {
		const ops = index.operations.filter(op => !flags.tag || op.tag?.toLowerCase() === String(flags.tag).toLowerCase())
		return { ok: true, count: ops.length, operations: ops.map(({ method: m, path, summary, scopes, badges, tag }) => ({ method: m, path, tag, summary, scopes, badges })) }
	}
	const m = String(method || '').toUpperCase()
	if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(m) || !apiPath?.startsWith('/')) {
		throw new TsaError('usage', 'Usage: tsa api <METHOD> </path/with/real/ids> [flags]   (or: tsa api list)')
	}
	const op = matchOperation(index, m, apiPath)
	if (!op) throw new TsaError('unknown_operation', `${m} ${apiPath} matches no operation in the bundled OpenAPI index. Run "tsa api list" or "tsa self-audit".`)
	const query = Object.fromEntries(list(flags.query).map(kv => kv.split(/=(.*)/s).slice(0, 2)))
	let body
	if (flags.bodyFile) body = fs.readFileSync(String(flags.bodyFile), 'utf8')
	else if (flags.body && flags.body !== true) body = String(flags.body)
	if (body !== undefined) { try { body = JSON.parse(body) } catch { /* keep as text, e.g. HuJSON */ } }
	const scopes = list(flags.scope).length ? list(flags.scope) : m === 'GET' ? ['all:read'] : []
	const operation = { method: m, path: apiPath, template: op.path, summary: op.summary, documentedScopes: op.scopes, badges: op.badges }
	if (m !== 'GET') {
		if (m === 'DELETE') confirmTarget(flags, apiPath)
		if (/\/acl$/.test(op.path) && m === 'POST') throw new TsaError('refused', 'Whole-file policy writes are not offered. Use the "policy ensure-*" commands.')
		if (!flags.apply) return { ok: true, status: STATUS.planned, operation, query, body }
	}
	const r = await request(m, apiPath, { scopes, query, body })
	const response = r.body ?? r.text
	let saved
	if (flags.out && flags.out !== true) {
		fs.writeFileSync(String(flags.out), JSON.stringify(response, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
		saved = String(flags.out)
	}
	return { ok: true, status: m === 'GET' ? 'ok' : STATUS.applied, operation, httpStatus: r.status, response: redactSecrets(response), ...(saved ? { savedFullResponseTo: saved } : {}) }
}

// Responses can carry secrets (webhook secrets, key material, OAuth client secrets). Blank any
// secret-named field; --out FILE (0600) keeps the full response for the consumer.
const SECRET_FIELD = /secret|^key$|token|password|credential/i
function redactSecrets(v, k = '') {
	if (Array.isArray(v)) return v.map(x => redactSecrets(x))
	if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([kk, vv]) => [kk, redactSecrets(vv, kk)]))
	if (typeof v === 'string' && SECRET_FIELD.test(k) && v) return '[REDACTED: re-run with --out FILE to save it]'
	return v
}
