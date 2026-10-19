// recipe subnet-router prepare|finish: the end-to-end subnet-router setup.
// prepare (before the router exists): one validated If-Match policy write (tag ownership,
//   route auto-approval, operator group, access rule) and a tagged, pre-authorised auth key.
// finish (after it joined): route enabled, key expiry disabled, optional key revocation.
// Each step reports planned / applied / already_in_place, so a second run is a no-op.
import { request } from '../lib/api.mjs'
import { flagOr, list, need, one, opts } from '../lib/args.mjs'
import { assertCidr, brief, isActiveKey, keyDescription, listDevices, overlaps, parseExpiry, policyWrite } from '../lib/flow.mjs'
import { STATUS, TsaError } from '../lib/out.mjs'
import { createAuthKey, listKeys } from './keys.mjs'

const sameHost = (h, hostname) => h === hostname || new RegExp(`^${hostname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+$`).test(h || '')

export async function run(_group, [name, stage], flags) {
	if (name !== 'subnet-router') throw new TsaError('usage', 'Available recipes: subnet-router prepare|finish')
	const o = opts(flags)
	if (stage === 'prepare') return prepare(o, flags)
	if (stage === 'finish') return finish(o, flags)
	throw new TsaError('usage', 'Usage: tsa recipe subnet-router prepare|finish [flags]')
}

async function prepare(o, flags) {
	const tag = one(flags, 'tag', '<tag:router-tag>')
	if (!tag.startsWith('tag:')) throw new TsaError('usage', 'Router tags start with "tag:".')
	const hostname = one(flags, 'hostname')
	const cidrs = list(need(flags, 'cidr')).map(assertCidr)
	const ports = list(need(flags, 'port'))
	const proto = flags.proto && flags.proto !== true ? String(flags.proto) : 'tcp'
	const group = flagOr(flags, 'group', o.config.operatorGroup)
	const members = list(flags.member)
	const automationTag = flagOr(flags, 'automationTag', o.config.automationTag)
	const owners = [...new Set([...(list(flags.tagOwner).length ? list(flags.tagOwner) : ['autogroup:admin']), automationTag])]
	const steps = []

	// 0. Safety: the CIDR must not overlap a route another device already advertises or serves.
	const devices = await listDevices(o)
	const clashes = devices
		.filter(d => !sameHost(d.hostname, hostname))
		.flatMap(d => [...new Set([...(d.advertisedRoutes || []), ...(d.enabledRoutes || [])])]
			.filter(r => !/^(0\.0\.0\.0|::)\/0$/.test(r) && cidrs.some(c => overlaps(c, r)))
			.map(r => ({ device: d.hostname, route: r })))
	if (clashes.length) {
		return { ok: false, status: STATUS.refused, reason: 'The requested CIDR overlaps routes already served by other devices. Choose another range or confirm with the tailnet admin.', clashes }
	}

	// 1-4. One policy write: tag ownership, auto-approval, group, access rule.
	const policy = await policyWrite(o, ed => {
		ed.ensureTagOwner(tag, owners)
		for (const c of cidrs) ed.ensureRouteApprover(c, [tag])
		if (members.length) ed.ensureGroupMembers(group, members)
		else if (ed.value(['groups', group]) === undefined) {
			throw new TsaError('usage', `${group} does not exist yet. Pass --member <login email> to create it.`)
		}
		ed.ensureAccessRule([group], cidrs, ports, proto)
	}, ['tagOwners', 'autoApprovers', 'groups', 'grants', 'acls'])
	steps.push({ step: 'policy', ...policy })
	if (policy.status === STATUS.refused) return { ok: false, status: STATUS.refused, steps }

	// 5. Auth key, unless the router already joined or an active key for it exists.
	const description = keyDescription(`subnet-router ${hostname}`)
	const joined = devices.filter(d => sameHost(d.hostname, hostname))
	if (flags.skipKey) {
		steps.push({ step: 'auth-key', status: 'skipped' })
	} else if (joined.length && !flags.newKey) {
		steps.push({ step: 'auth-key', status: STATUS.inPlace, note: `${hostname} has already joined; no key needed (pass --new-key to mint one anyway).` })
	} else {
		const existing = (await listKeys(o)).filter(k => k.keyType === 'auth' && k.description === description && isActiveKey(k))
		if (existing.length && !flags.newKey) {
			steps.push({ step: 'auth-key', status: STATUS.inPlace, note: `Active key ${existing[0].id} already exists for ${hostname}; its secret was saved when it was created. Pass --new-key to mint another.`, keyId: existing[0].id })
		} else {
			const r = await createAuthKey(o, {
				tags: [tag], out: one(flags, 'keyOut', '<file> (0600; the key is never printed)'),
				expirySeconds: parseExpiry(flagOr(flags, 'keyExpiry', o.config.keyExpiry)),
				reusable: !!flags.reusable, ephemeral: false, preauthorized: true, description,
			})
			steps.push({ step: 'auth-key', ...r })
		}
	}
	return summarise(steps, {
		next: `On the router: tailscale up --auth-key="$(cat <key file>)" --hostname=${hostname} --advertise-routes=${cidrs.join(',')} --advertise-tags=${tag}. Then run: tsa recipe subnet-router finish --hostname ${hostname} --cidr ${cidrs.join(' --cidr ')}`,
	})
}

async function finish(o, flags) {
	const hostname = one(flags, 'hostname')
	const cidrs = list(need(flags, 'cidr')).map(assertCidr)
	const steps = []
	const matches = (await listDevices(o)).filter(d => sameHost(d.hostname, hostname))
	if (!matches.length) return { ok: false, status: STATUS.refused, reason: `No device named ${hostname} has joined yet.` }
	if (matches.length > 1) {
		return { ok: false, status: STATUS.refused, reason: `${matches.length} devices match ${hostname} (re-joins create ${hostname}-1 etc.). Delete the stale ones with "tsa devices delete --device <id> --confirm <id> --apply", then re-run.`, matches: matches.map(brief) }
	}
	const d = matches[0]
	const id = encodeURIComponent(d.nodeId || d.id)

	const advertised = d.advertisedRoutes || [], enabled = d.enabledRoutes || []
	const notAdvertised = cidrs.filter(c => !advertised.includes(c))
	const toEnable = cidrs.filter(c => !enabled.includes(c))
	if (!toEnable.length) steps.push({ step: 'routes', status: STATUS.inPlace })
	else {
		const body = { routes: [...new Set([...enabled, ...toEnable])] }
		if (o.apply) await request('POST', `/device/${id}/routes`, { scopes: ['devices:routes'], body })
		steps.push({ step: 'routes', status: o.apply ? STATUS.applied : STATUS.planned, change: `enable ${toEnable.join(', ')}`, request: { method: 'POST', path: `/device/${id}/routes`, body } })
	}
	if (notAdvertised.length) steps.push({ step: 'routes-advertised', status: 'warning', note: `${hostname} does not advertise ${notAdvertised.join(', ')}; check its --advertise-routes.` })

	if (d.keyExpiryDisabled) steps.push({ step: 'key-expiry', status: STATUS.inPlace })
	else {
		if (o.apply) await request('POST', `/device/${id}/key`, { scopes: ['devices:core'], body: { keyExpiryDisabled: true } })
		steps.push({ step: 'key-expiry', status: o.apply ? STATUS.applied : STATUS.planned, change: 'disable key expiry' })
	}

	if (flags.revokeKey) {
		const description = keyDescription(`subnet-router ${hostname}`)
		const active = (await listKeys(o)).filter(k => k.keyType === 'auth' && k.description === description && isActiveKey(k))
		if (!active.length) steps.push({ step: 'revoke-key', status: STATUS.inPlace })
		else {
			if (o.apply) for (const k of active) await request('DELETE', `/tailnet/${encodeURIComponent(o.tailnet)}/keys/${k.id}`, { scopes: ['auth_keys'] })
			steps.push({ step: 'revoke-key', status: o.apply ? STATUS.applied : STATUS.planned, keys: active.map(k => k.id) })
		}
	}

	const after = o.apply ? (await listDevices(o)).find(x => x.nodeId === d.nodeId) || d : d
	return summarise(steps, { device: brief(after) })
}

function summarise(steps, extra) {
	const statuses = steps.map(s => s.status)
	const status = statuses.every(s => s === STATUS.inPlace || s === 'skipped') ? STATUS.inPlace
		: statuses.includes(STATUS.refused) ? STATUS.refused
		: statuses.includes(STATUS.planned) ? STATUS.planned : STATUS.applied
	return { ok: status !== STATUS.refused, status, steps, ...extra }
}
