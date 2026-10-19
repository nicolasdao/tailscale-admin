// The skill ships a derived index of the Tailscale OpenAPI document (assets/operations.json),
// never the document itself. The index drives `tsa api` path checks and `tsa self-audit`.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from '../vendor/js-yaml/js-yaml.mjs'

export const SPEC_URL = 'https://api.tailscale.com/api/v2?outputOpenapiSchema=true'
export const INDEX_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'operations.json')
const METHODS = ['get', 'post', 'put', 'patch', 'delete']

const scopesOf = (desc = '') => [...desc.matchAll(/OAuth Scope[s]?:\s*([^\n]+)/g)]
	.flatMap(m => [...m[1].matchAll(/`([a-z_:]+)`/g)].map(x => x[1]))

function fingerprint(op, pathItem) {
	const h = crypto.createHash('sha256')
	h.update(JSON.stringify({ op, params: pathItem.parameters || [] }))
	return h.digest('hex').slice(0, 16)
}

export function buildIndex(spec) {
	const ops = []
	for (const [p, item] of Object.entries(spec.paths || {})) {
		for (const m of METHODS) {
			const op = item[m]
			if (!op) continue
			ops.push({
				method: m.toUpperCase(),
				path: p,
				operationId: op.operationId,
				tag: (op.tags || [])[0],
				summary: op.summary,
				scopes: [...new Set(scopesOf(op.description))],
				badges: (op['x-badges'] || []).map(b => b.name),
				deprecated: !!op.deprecated,
				fp: fingerprint(op, item),
			})
		}
	}
	return { source: SPEC_URL, version: spec.info?.version, generated: new Date().toISOString().slice(0, 10), count: ops.length, operations: ops }
}

export async function fetchLiveSpec() {
	const res = await fetch(SPEC_URL)
	if (!res.ok) throw new Error(`Could not download the OpenAPI document: HTTP ${res.status}`)
	return yaml.load(await res.text())
}

export const loadIndex = () => JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'))

// Match a concrete path (/tailnet/-/devices) against the index's templates (/tailnet/{tailnet}/devices).
export function matchOperation(index, method, concretePath) {
	const clean = concretePath.split('?')[0].replace(/\/+$/, '')
	return index.operations.find(o => {
		if (o.method !== method) return false
		const re = new RegExp('^' + o.path.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\?\{[^}]+\\?\}/g, '[^/]+').replace(/\{[^}]+\}/g, '[^/]+') + '$')
		return re.test(clean)
	})
}

export function diffIndex(oldIdx, newIdx) {
	const key = o => `${o.method} ${o.path}`
	const a = new Map(oldIdx.operations.map(o => [key(o), o]))
	const b = new Map(newIdx.operations.map(o => [key(o), o]))
	const added = [...b.keys()].filter(k => !a.has(k))
	const removed = [...a.keys()].filter(k => !b.has(k))
	const changed = []
	for (const [k, o] of b) {
		const prev = a.get(k)
		if (!prev || prev.fp === o.fp) continue
		const fields = ['summary', 'scopes', 'badges', 'deprecated'].filter(f => JSON.stringify(prev[f]) !== JSON.stringify(o[f]))
		changed.push({ operation: k, fields: fields.length ? fields : ['details (parameters, schema or description)'] })
	}
	return { added, removed, changed }
}
