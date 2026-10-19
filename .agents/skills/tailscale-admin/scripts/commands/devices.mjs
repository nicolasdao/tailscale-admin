// devices and routes. Every write reads current state first, then merges, so list-replacing
// endpoints (routes, tags) never drop entries they were not asked to change.
import { request } from '../lib/api.mjs'
import { confirmTarget, list, need, one, opts } from '../lib/args.mjs'
import { assertCidr, brief, listDevices, resolveDevice } from '../lib/flow.mjs'
import { STATUS, TsaError } from '../lib/out.mjs'

const did = (d) => encodeURIComponent(d.nodeId || d.id)

// Plan or apply one API write. `already` short-circuits to already_in_place.
async function write({ apply, already, method, path, body, scopes, describe }) {
	if (already) return { status: STATUS.inPlace }
	const plan = { method, path, body }
	if (!apply) return { status: STATUS.planned, change: describe, request: plan }
	await request(method, path, { scopes, body })
	return { status: STATUS.applied, change: describe, request: plan }
}

export async function run(group, [verb], flags) {
	const o = opts(flags)
	if (group === 'routes') return routes(verb, flags, o)
	switch (verb) {
		case 'list': {
			const query = {}
			if (flags.tag) query.tags = list(flags.tag)
			if (flags.hostname) query.hostname = one(flags, 'hostname')
			if (flags.os) query.os = one(flags, 'os')
			const ds = await listDevices(o, ['devices:core:read'], query)
			return { ok: true, count: ds.length, devices: ds.map(brief) }
		}
		case 'get': {
			const d = await resolveDevice(o, one(flags, 'device'))
			return { ok: true, device: flags.full ? d : brief(d) }
		}
		case 'key-expiry': {
			if (!flags.disable && !flags.enable) throw new TsaError('usage', 'Pass --disable or --enable.')
			const want = !!flags.disable
			const d = await resolveDevice(o, one(flags, 'device'))
			const r = await write({
				apply: o.apply, already: d.keyExpiryDisabled === want, method: 'POST', path: `/device/${did(d)}/key`,
				body: { keyExpiryDisabled: want }, scopes: ['devices:core'],
				describe: `${want ? 'disable' : 'enable'} key expiry on ${d.hostname}`,
			})
			return { ok: true, device: d.hostname, ...r }
		}
		case 'tags': {
			const d = await resolveDevice(o, one(flags, 'device'))
			const cur = d.tags || []
			const next = [...new Set([...cur, ...list(flags.add)])].filter(t => !list(flags.remove).includes(t))
			const r = await write({
				apply: o.apply, already: JSON.stringify([...cur].sort()) === JSON.stringify([...next].sort()),
				method: 'POST', path: `/device/${did(d)}/tags`, body: { tags: next }, scopes: ['devices:core'],
				describe: `set tags on ${d.hostname}: [${cur.join(', ')}] -> [${next.join(', ')}]`,
			})
			return { ok: true, device: d.hostname, ...r }
		}
		case 'authorize': {
			const d = await resolveDevice(o, one(flags, 'device'))
			const r = await write({
				apply: o.apply, already: d.authorized === true, method: 'POST', path: `/device/${did(d)}/authorized`,
				body: { authorized: true }, scopes: ['devices:core'], describe: `authorize ${d.hostname}`,
			})
			return { ok: true, device: d.hostname, ...r }
		}
		case 'delete': {
			const ref = one(flags, 'device')
			const d = await resolveDevice(o, ref)
			confirmTarget(flags, ref)
			const r = await write({
				apply: o.apply, method: 'DELETE', path: `/device/${did(d)}`, scopes: ['devices:core'],
				describe: `DELETE device ${d.hostname} (${d.nodeId || d.id}); it must re-authenticate to rejoin`,
			})
			return { ok: true, device: brief(d), ...r }
		}
		default:
			throw new TsaError('usage', `Unknown devices verb "${verb}". Run: node tsa.mjs devices --help`)
	}
}

async function routes(verb, flags, o) {
	const d = await resolveDevice(o, one(flags, 'device'))
	const advertised = d.advertisedRoutes || []
	const enabled = d.enabledRoutes || []
	if (verb === 'list') return { ok: true, device: d.hostname, advertisedRoutes: advertised, enabledRoutes: enabled, pending: advertised.filter(r => !enabled.includes(r)) }
	if (verb !== 'approve' && verb !== 'remove') throw new TsaError('usage', `Unknown routes verb "${verb}". Run: node tsa.mjs routes --help`)
	const cidrs = list(need(flags, 'cidr')).map(assertCidr)
	const next = verb === 'approve' ? [...new Set([...enabled, ...cidrs])] : enabled.filter(r => !cidrs.includes(r))
	const notAdvertised = verb === 'approve' ? cidrs.filter(c => !advertised.includes(c)) : []
	const r = await write({
		apply: o.apply, already: next.length === enabled.length && next.every(x => enabled.includes(x)),
		method: 'POST', path: `/device/${did(d)}/routes`, body: { routes: next }, scopes: ['devices:routes'],
		describe: `enabled routes on ${d.hostname}: [${enabled.join(', ')}] -> [${next.join(', ')}]`,
	})
	return {
		ok: true, device: d.hostname, ...r,
		...(notAdvertised.length ? { warning: `Not advertised by the device yet: ${notAdvertised.join(', ')}. Enabled routes only carry traffic once the device advertises them.` } : {}),
	}
}
