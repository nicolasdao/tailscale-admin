// policy: read, validate, preview and targeted ensure-* edits of the tailnet policy file.
import fs from 'node:fs'
import { request } from '../lib/api.mjs'
import { list, need, one, opts } from '../lib/args.mjs'
import { assertCidr, policyWrite, readPolicy, tn, validatePolicy } from '../lib/flow.mjs'
import { TsaError } from '../lib/out.mjs'
import { parsePolicy } from '../lib/policy.mjs'

const shape = (v) => Array.isArray(v) ? `array[${v.length}]` : v && typeof v === 'object' ? `object{${Object.keys(v).length}}` : typeof v

export async function run(_group, [verb], flags) {
	const o = opts(flags)
	switch (verb) {
		case 'get': {
			const { text, etag } = await readPolicy(o)
			if (flags.raw) return { ok: true, etag, hujson: text }
			const p = parsePolicy(text)
			return {
				ok: true, etag,
				sections: Object.fromEntries(Object.entries(p).map(([k, v]) => [k, shape(v)])),
				tagOwners: Object.keys(p.tagOwners || {}),
				groups: Object.keys(p.groups || {}),
				autoApprovedRoutes: Object.keys(p.autoApprovers?.routes || {}),
				ruleSection: p.grants ? 'grants' : p.acls ? 'acls' : 'none',
			}
		}
		case 'validate': {
			const text = fs.readFileSync(one(flags, 'file', '<policy.hujson>'), 'utf8')
			return { ok: true, ...(await validatePolicy(o, text)) }
		}
		case 'preview': {
			const type = one(flags, 'type', 'user|ipport')
			const text = flags.file ? fs.readFileSync(String(flags.file), 'utf8') : (await readPolicy(o)).text
			const r = await request('POST', `/tailnet/${tn(o)}/acl/preview`, {
				scopes: ['policy_file:read'], body: text, contentType: 'application/hujson',
				query: { type, previewFor: one(flags, 'for', '<email or ip:port>') },
			})
			return { ok: true, preview: r.body }
		}
		case 'ensure-tag-owner': {
			const tag = one(flags, 'tag'), owners = list(need(flags, 'owner'))
			return { ok: true, ...(await policyWrite(o, ed => ed.ensureTagOwner(tag, owners), ['tagOwners'])) }
		}
		case 'ensure-auto-approver': {
			const route = assertCidr(one(flags, 'route')), approvers = list(need(flags, 'approver'))
			return { ok: true, ...(await policyWrite(o, ed => ed.ensureRouteApprover(route, approvers), ['autoApprovers'])) }
		}
		case 'ensure-exit-node-approver': {
			const approver = one(flags, 'approver')
			return { ok: true, ...(await policyWrite(o, ed => ed.ensureExitNodeApprover(approver), ['autoApprovers'])) }
		}
		case 'ensure-group': {
			const group = one(flags, 'group'), members = list(need(flags, 'member'))
			if (!group.startsWith('group:')) throw new TsaError('usage', 'Group names start with "group:".')
			return { ok: true, ...(await policyWrite(o, ed => ed.ensureGroupMembers(group, members), ['groups'])) }
		}
		case 'ensure-rule': {
			const src = list(need(flags, 'src')), dst = list(need(flags, 'dst')).map(assertCidr), ports = list(need(flags, 'port'))
			const proto = flags.proto && flags.proto !== true ? String(flags.proto) : 'tcp'
			return { ok: true, ...(await policyWrite(o, ed => ed.ensureAccessRule(src, dst, ports, proto), ['grants', 'acls'])) }
		}
		case 'remove-tag-owner': {
			const tag = one(flags, 'tag')
			return { ok: true, ...(await policyWrite(o, ed => ed.removeTagOwner(tag), ['tagOwners'])) }
		}
		case 'remove-auto-approver': {
			const route = assertCidr(one(flags, 'route'))
			return { ok: true, ...(await policyWrite(o, ed => ed.removeRouteApprover(route), ['autoApprovers'])) }
		}
		case 'remove-rule': {
			const src = list(need(flags, 'src')), dst = list(need(flags, 'dst')).map(assertCidr), ports = list(need(flags, 'port'))
			const proto = flags.proto && flags.proto !== true ? String(flags.proto) : 'tcp'
			return { ok: true, ...(await policyWrite(o, ed => ed.removeAccessRule(src, dst, ports, proto), ['grants', 'acls'])) }
		}
		default:
			throw new TsaError('usage', `Unknown policy verb "${verb}". Run: node tsa.mjs policy --help`)
	}
}
