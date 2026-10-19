// auth check, users list, dns get, settings get.
import { grantedScopes, request } from '../lib/api.mjs'
import { loadCredentials } from '../lib/env.mjs'
import { tn } from '../lib/flow.mjs'
import { opts } from '../lib/args.mjs'
import { TsaError } from '../lib/out.mjs'

export async function run(group, [verb], flags) {
	const o = opts(flags)
	const key = `${group} ${verb}`
	switch (key) {
		case 'auth check': {
			const { source, missing } = loadCredentials()
			if (missing.length) return { ok: false, status: 'credentials_missing', envFile: source, missing }
			return { ok: true, envFile: source, grantedScopes: await grantedScopes([]) }
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
