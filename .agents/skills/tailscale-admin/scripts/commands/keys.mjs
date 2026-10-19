// keys: list, create tagged auth keys (secret written to a 0600 file, never printed), revoke.
import fs from 'node:fs'
import path from 'node:path'
import { request } from '../lib/api.mjs'
import { confirmTarget, flagOr, list, need, one, opts } from '../lib/args.mjs'
import { isActiveKey, keyDescription, parseExpiry, tn } from '../lib/flow.mjs'
import { STATUS, TsaError } from '../lib/out.mjs'

const briefKey = (k) => ({
	id: k.id, keyType: k.keyType, description: k.description, created: k.created, expires: k.expires,
	revoked: k.revoked, tags: k.capabilities?.devices?.create?.tags || k.tags,
	reusable: k.capabilities?.devices?.create?.reusable, active: isActiveKey(k),
})

export async function listKeys(o) {
	const r = await request('GET', `/tailnet/${tn(o)}/keys`, { scopes: ['all:read'], query: { all: true } })
	return r.body.keys || []
}

// Create an auth key and write its secret to `out` (0600, never overwrites). Returns metadata only.
export async function createAuthKey(o, { tags, out, expirySeconds, reusable, ephemeral, preauthorized, description }) {
	if (!out) throw new TsaError('usage', 'Missing --out <file>: new keys are written to a 0600 file, never printed.')
	const outPath = path.resolve(out)
	if (fs.existsSync(outPath)) throw new TsaError('refused', `${outPath} already exists; refusing to overwrite a secret file.`)
	const body = {
		capabilities: { devices: { create: { reusable, ephemeral, preauthorized, tags } } },
		expirySeconds,
		...(description ? { description: keyDescription(description) } : {}),
	}
	if (!o.apply) return { status: STATUS.planned, request: { method: 'POST', path: `/tailnet/${tn(o)}/keys`, body }, out: outPath }
	const r = await request('POST', `/tailnet/${tn(o)}/keys`, { scopes: ['auth_keys'], body })
	fs.mkdirSync(path.dirname(outPath), { recursive: true })
	// No trailing newline: consumers like `aws ssm put-parameter --value file://…` store the bytes verbatim.
	fs.writeFileSync(outPath, r.body.key, { mode: 0o600, flag: 'wx' })
	return { status: STATUS.applied, key: briefKey(r.body), out: outPath, note: 'The key is only in the file. Hand it to its consumer, then delete the file.' }
}

export async function run(_group, [verb], flags) {
	const o = opts(flags)
	switch (verb) {
		case 'list': {
			const ks = await listKeys(o)
			return { ok: true, count: ks.length, keys: ks.map(briefKey) }
		}
		case 'create-auth': {
			const r = await createAuthKey(o, {
				tags: list(need(flags, 'tag', '(OAuth-minted keys must be tagged)')),
				out: one(flags, 'out', '<file>'),
				expirySeconds: parseExpiry(flagOr(flags, 'expiry', o.config.keyExpiry)),
				reusable: !!flags.reusable,
				ephemeral: !!flags.ephemeral,
				preauthorized: !flags.noPreauthorized,
				description: flags.description && flags.description !== true ? String(flags.description) : undefined,
			})
			return { ok: true, ...r }
		}
		case 'revoke': {
			const id = one(flags, 'key')
			confirmTarget(flags, id)
			const k = (await listKeys(o)).find(x => x.id === id)
			if (!k) return { ok: true, status: STATUS.inPlace, note: `No active key ${id}.` }
			const plan = { method: 'DELETE', path: `/tailnet/${tn(o)}/keys/${id}` }
			if (!o.apply) return { ok: true, status: STATUS.planned, key: briefKey(k), request: plan }
			await request('DELETE', plan.path, { scopes: [k.keyType === 'auth' ? 'auth_keys' : 'all'] })
			return { ok: true, status: STATUS.applied, key: briefKey(k), note: 'Devices that already joined with this key stay joined.' }
		}
		default:
			throw new TsaError('usage', `Unknown keys verb "${verb}". Run: node tsa.mjs keys --help`)
	}
}
