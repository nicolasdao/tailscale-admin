// auth check, users list, dns get, settings get.
import fs from 'node:fs'
import { grantedScopes, request } from '../lib/api.mjs'
import { loadCredentials } from '../lib/env.mjs'
import { tn } from '../lib/flow.mjs'
import { opts } from '../lib/args.mjs'
import { TsaError } from '../lib/out.mjs'

// Install creates the secrets file group/world-readable; flag it (POSIX only) with the exact fix.
function permissionWarning(file) {
	if (process.platform === 'win32' || !fs.existsSync(file)) return undefined
	const mode = fs.statSync(file).mode & 0o777
	if (!(mode & 0o077)) return undefined
	return `${file} is readable by other users on this machine (mode ${mode.toString(8)}). Run: chmod 600 "${file}"`
}

export async function run(group, [verb], flags) {
	const o = opts(flags)
	const key = `${group} ${verb}`
	switch (key) {
		case 'auth check': {
			const { source, missing } = loadCredentials()
			const warning = permissionWarning(source)
			if (missing.length) return { ok: false, status: 'credentials_missing', envFile: source, missing, next: 'Fill in the empty values in envFile (see references/setup.md), then re-run auth check.', ...(warning ? { warning } : {}) }
			return { ok: true, envFile: source, grantedScopes: await grantedScopes([]), ...(warning ? { warning } : {}) }
		}
		case 'users list': {
			const r = await request('GET', `/tailnet/${tn(o)}/users`, { scopes: ['users:read'] })
			return { ok: true, count: r.body.users.length, users: r.body.users.map(u => ({ id: u.id, loginName: u.loginName, displayName: u.displayName, role: u.role, status: u.status, type: u.type })) }
		}
		case 'dns get': {
			const r = await request('GET', `/tailnet/${tn(o)}/dns/configuration`, { scopes: ['dns:read'] })
			return { ok: true, dns: r.body }
		}
		case 'settings get': {
			const r = await request('GET', `/tailnet/${tn(o)}/settings`, { scopes: ['feature_settings:read'] })
			return { ok: true, settings: r.body }
		}
		default:
			throw new TsaError('usage', `Unknown command "${key}". Run: node tsa.mjs help`)
	}
}
