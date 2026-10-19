// Targeted, comment-preserving edits to a HuJSON policy file.
// jsonc-parser only LOCATES nodes; every change is an insertion of new text, so comments,
// formatting and unrelated sections survive byte for byte. Nothing is ever reformatted or deleted.
import { createRequire } from 'node:module'
import { TsaError } from './out.mjs'

const require = createRequire(import.meta.url)
const { parseTree, findNodeAtLocation, getNodeValue, parse } = require('../vendor/jsonc-parser/umd/main.js')

const PARSE_OPTS = { allowTrailingComma: true, disallowComments: false }
const j = (v) => JSON.stringify(v).replace(/([,:])(?=["\[{])/g, '$1 ')
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

export function parsePolicy(text) {
	const errors = []
	const value = parse(text, errors, PARSE_OPTS)
	if (errors.length) throw new TsaError('policy_parse', `The policy file does not parse as HuJSON (${errors.length} error(s), first at offset ${errors[0].offset}).`)
	return value
}

export class PolicyEditor {
	constructor(text) {
		this.original = text
		this.text = text
		this.changes = []
		parsePolicy(text)
	}

	tree() { return parseTree(this.text, [], PARSE_OPTS) }
	node(path) { return path.length ? findNodeAtLocation(this.tree(), path) : this.tree() }
	value(path) { const n = this.node(path); return n ? getNodeValue(n) : undefined }
	indentAt(offset) { return this.text.slice(this.text.lastIndexOf('\n', offset) + 1).match(/^[\t ]*/)[0] }
	unit() { return /\n\t/.test(this.text) ? '\t' : '  ' }

	// Insert `snippet` as a new member/element of the container at `path`, on its own line(s),
	// after the last sibling's line (so a trailing comment stays with its own entry).
	appendMember(path, snippet) {
		const c = this.node(path)
		if (!c || (c.type !== 'object' && c.type !== 'array')) throw new TsaError('policy_shape', `Cannot add to ${path.join('.') || 'the root'}: it is not an object or array.`)
		const kids = c.children || []
		if (!kids.length) {
			const ind = this.indentAt(c.offset)
			const open = this.text[c.offset], close = this.text[c.offset + c.length - 1]
			const body = snippet.split('\n').map(l => ind + this.unit() + l).join('\n')
			this.text = this.text.slice(0, c.offset) + `${open}\n${body},\n${ind}${close}` + this.text.slice(c.offset + c.length)
			return
		}
		const last = kids[kids.length - 1]
		const end = last.offset + last.length
		const ind = this.indentAt(last.offset)
		let lineEnd = this.text.indexOf('\n', end)
		if (lineEnd === -1) lineEnd = this.text.length
		let rest = this.text.slice(end, lineEnd)
		const closeIdx = rest.search(/[\]}]/)
		if (closeIdx !== -1 && !/\/\//.test(rest.slice(0, closeIdx))) {
			// The container closes on the same line as its last element (e.g. {"a": 1}): break before the closer.
			const before = rest.slice(0, closeIdx).replace(/\s*,?\s*$/, '')
			const outer = this.indentAt(c.offset)
			const body = snippet.split('\n').map(l => outer + this.unit() + l).join('\n')
			this.text = this.text.slice(0, end) + before + ',\n' + body + ',\n' + outer + rest.slice(closeIdx) + this.text.slice(lineEnd)
			return
		}
		if (!/^\s*,/.test(rest)) rest = ',' + rest
		const body = snippet.split('\n').map(l => ind + l).join('\n')
		this.text = this.text.slice(0, end) + rest + '\n' + body + ',' + this.text.slice(lineEnd)
	}

	// Append a scalar to an existing array, on the same line as its last element.
	appendToArray(path, v) {
		const arr = this.node(path)
		if (!arr || arr.type !== 'array') throw new TsaError('policy_shape', `${path.join('.')} is not an array.`)
		if (!arr.children.length) {
			this.text = this.text.slice(0, arr.offset) + `[${j(v)}]` + this.text.slice(arr.offset + arr.length)
			return
		}
		const last = arr.children[arr.children.length - 1]
		const end = last.offset + last.length
		this.text = this.text.slice(0, end) + `, ${j(v)}` + this.text.slice(end)
	}

	// Ensure a top-level object section exists (e.g. "groups", "tagOwners", "autoApprovers").
	ensureSection(name, nested = []) {
		if (this.value([name]) !== undefined) return
		if (!nested.length) {
			this.appendMember([], `${j(name)}: {}`)
		} else {
			this.appendMember([], `${j(name)}: {\n${this.unit()}${j(nested[0])}: {},\n}`)
		}
		this.changes.push(`create section ${[name, ...nested].join('.')}`)
	}

	// Ensure path[...]=key exists as a list containing every item of `members`.
	ensureListMembers(parent, key, members, label) {
		for (let i = 0; i < parent.length; i++) {
			const p = parent.slice(0, i + 1)
			if (this.value(p) === undefined) {
				if (i === 0) this.ensureSection(p[0], parent.slice(1))
				else this.appendMember(p.slice(0, -1), `${j(p[p.length - 1])}: {}`)
			}
		}
		const cur = this.value([...parent, key])
		if (cur === undefined) {
			this.appendMember(parent, `${j(key)}: ${j(members)}`)
			this.changes.push(`${label}: add ${key} = ${members.join(', ')}`)
			return true
		}
		if (!Array.isArray(cur)) throw new TsaError('policy_shape', `${[...parent, key].join('.')} is not a list.`)
		let changed = false
		for (const m of members) {
			if (!this.value([...parent, key]).includes(m)) {
				this.appendToArray([...parent, key], m)
				this.changes.push(`${label}: add ${m} to ${key}`)
				changed = true
			}
		}
		return changed
	}

	ensureTagOwner(tag, owners) { return this.ensureListMembers(['tagOwners'], tag, owners, 'tagOwners') }
	ensureRouteApprover(cidr, approvers) { return this.ensureListMembers(['autoApprovers', 'routes'], cidr, approvers, 'autoApprovers.routes') }
	ensureGroupMembers(group, members) { return this.ensureListMembers(['groups'], group, members, 'groups') }

	ensureExitNodeApprover(approver) {
		if (this.value(['autoApprovers']) === undefined) this.ensureSection('autoApprovers')
		const cur = this.value(['autoApprovers', 'exitNode'])
		if (cur === undefined) { this.appendMember(['autoApprovers'], `"exitNode": ${j([approver])}`); this.changes.push(`autoApprovers.exitNode: add ${approver}`); return true }
		if (cur.includes(approver)) return false
		this.appendToArray(['autoApprovers', 'exitNode'], approver)
		this.changes.push(`autoApprovers.exitNode: add ${approver}`)
		return true
	}

	// Remove one member/element ONLY when it occupies whole lines by itself (nothing but
	// whitespace before it, nothing but a comma after it, no comment). Otherwise refuse:
	// the edit must never touch a neighbour or a comment.
	removeWholeLines(path, label) {
		const n = this.node(path)
		if (!n) return false
		const target = n.parent?.type === 'property' ? n.parent : n
		const start = this.text.lastIndexOf('\n', target.offset) + 1
		const end = target.offset + target.length
		const nl = this.text.indexOf('\n', end)
		const after = this.text.slice(end, nl === -1 ? this.text.length : nl)
		if (this.text.slice(start, target.offset).trim() || !/^\s*,?\s*$/.test(after)) {
			throw new TsaError('policy_shape', `${path.join('.')} shares its line with other text or a comment; remove it by hand.`)
		}
		this.removed = [...(this.removed || []), ...this.text.slice(start, nl === -1 ? this.text.length : nl).split('\n')]
		this.text = this.text.slice(0, start) + this.text.slice(nl === -1 ? this.text.length : nl + 1)
		this.changes.push(`${label}: remove ${path[path.length - 1]}`)
		return true
	}

	removeTagOwner(tag) { return this.removeWholeLines(['tagOwners', tag], 'tagOwners') }
	removeRouteApprover(cidr) { return this.removeWholeLines(['autoApprovers', 'routes', cidr], 'autoApprovers.routes') }
	removeAccessRule(src, cidrs, ports, proto = 'tcp') {
		for (const section of ['grants', 'acls']) {
			const rules = this.value([section]) || []
			const rule = section === 'grants'
				? { src, dst: cidrs, ip: ports.map(p => `${proto}:${p}`) }
				: { action: 'accept', src, dst: cidrs.flatMap(c => ports.map(p => `${c}:${p}`)), ...(proto !== 'tcp' ? { proto } : {}) }
			const idx = rules.findIndex(r => same(r, rule))
			if (idx !== -1) return this.removeWholeLines([section, idx], section)
		}
		return false
	}

	// Which access-rule section to append to: whatever the policy already uses.
	ruleSection() {
		const grants = this.value(['grants'])
		const acls = this.value(['acls'])
		if (Array.isArray(grants) && grants.length && grants.every(g => g.via) && !(Array.isArray(acls) && acls.length)) {
			throw new TsaError('policy_unsupported', 'Every grant in this policy uses "via"; adding a plain rule could change routing semantics. Edit it by hand or ask the tailnet admin.')
		}
		if (Array.isArray(grants)) return 'grants'
		if (Array.isArray(acls)) return 'acls'
		return 'grants'
	}

	// Access rule: src may reach cidr on ports. Idempotent on an exact-match rule.
	ensureAccessRule(src, cidrs, ports, proto = 'tcp') {
		const section = this.ruleSection()
		const rule = section === 'grants'
			? { src, dst: cidrs, ip: ports.map(p => `${proto}:${p}`) }
			: { action: 'accept', src, dst: cidrs.flatMap(c => ports.map(p => `${c}:${p}`)), ...(proto !== 'tcp' ? { proto } : {}) }
		const existing = this.value([section]) || []
		if (existing.some(r => same(r, rule))) return false
		if (this.value([section]) === undefined) this.appendMember([], `${j(section)}: []`)
		this.appendMember([section], j(rule))
		this.changes.push(`${section}: add ${j(rule)}`)
		return true
	}

	// Safety net: the edited text must parse, and every top-level section the caller did not
	// touch must be semantically identical to the original.
	verify(touched) {
		const before = parsePolicy(this.original)
		const after = parsePolicy(this.text)
		for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
			if (touched.includes(k)) continue
			if (!same(before[k], after[k])) throw new TsaError('policy_guard', `Internal guard: section "${k}" changed unexpectedly. Nothing was written.`)
		}
		const removed = diffLines(this.original, this.text).filter(l => l.op === '-').map(l => l.line)
		const added = new Set(diffLines(this.original, this.text).filter(l => l.op === '+').map(l => l.line))
		// A removed line is acceptable only when it reappears extended (a value appended inside it),
		// or when an explicit remove* call deleted exactly that line.
		const allowed = [...(this.removed || [])]
		for (const r of removed) {
			const i = allowed.indexOf(r)
			if (i !== -1) { allowed.splice(i, 1); continue }
			if (![...added].some(a => a.startsWith(r.replace(/[\]},\s]*(\/\/.*)?$/, '')))) {
				throw new TsaError('policy_guard', `Internal guard: the edit would remove a line (${r.trim().slice(0, 80)}). Nothing was written.`)
			}
		}
		return true
	}

	diff(label = 'policy.hujson') { return unifiedDiff(this.original, this.text, label) }
	get changed() { return this.text !== this.original }
}

// Line diff via LCS. Policy files are small (hundreds of lines), so O(n*m) is fine.
export function diffLines(a, b) {
	const x = a.split('\n'), y = b.split('\n')
	const n = x.length, m = y.length
	const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
	for (let i = n - 1; i >= 0; i--) for (let k = m - 1; k >= 0; k--) dp[i][k] = x[i] === y[k] ? dp[i + 1][k + 1] + 1 : Math.max(dp[i + 1][k], dp[i][k + 1])
	const out = []
	let i = 0, k = 0
	while (i < n || k < m) {
		if (i < n && k < m && x[i] === y[k]) { out.push({ op: ' ', line: x[i], a: i, b: k }); i++; k++ }
		else if (i < n && (k >= m || dp[i + 1][k] >= dp[i][k + 1])) { out.push({ op: '-', line: x[i], a: i, b: k }); i++ }
		else { out.push({ op: '+', line: y[k], a: i, b: k }); k++ }
	}
	return out
}

export function unifiedDiff(a, b, label, context = 3) {
	const lines = diffLines(a, b)
	const changed = lines.map((l, idx) => (l.op !== ' ' ? idx : -1)).filter(i => i >= 0)
	if (!changed.length) return ''
	const hunks = []
	let start = Math.max(0, changed[0] - context), end = Math.min(lines.length, changed[0] + context + 1)
	for (const c of changed.slice(1)) {
		if (c - context <= end) end = Math.min(lines.length, c + context + 1)
		else { hunks.push([start, end]); start = Math.max(0, c - context); end = Math.min(lines.length, c + context + 1) }
	}
	hunks.push([start, end])
	const out = [`--- a/${label}`, `+++ b/${label}`]
	for (const [s, e] of hunks) {
		const seg = lines.slice(s, e)
		const aStart = seg[0].a + 1, bStart = seg[0].b + 1
		const aLen = seg.filter(l => l.op !== '+').length, bLen = seg.filter(l => l.op !== '-').length
		out.push(`@@ -${aStart},${aLen} +${bStart},${bLen} @@`)
		for (const l of seg) out.push(l.op + l.line)
	}
	return out.join('\n')
}
