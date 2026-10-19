#!/usr/bin/env node
// Prototype: targeted, comment-preserving HuJSON edits that only ever INSERT text.
// jsonc-parser locates nodes; insertions are line-aware and copy the sibling indentation.
// Usage: node policy-edit-proto.mjs <policy.hujson>   (prints the edited policy)
import fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { parseTree, findNodeAtLocation, getNodeValue } = require('jsonc-parser')

let text = fs.readFileSync(process.argv[2], 'utf8')
const node = (path) => findNodeAtLocation(parseTree(text, [], { allowTrailingComma: true }), path)
const value = (path) => { const n = node(path); return n ? getNodeValue(n) : undefined }
const indentAt = (offset) => text.slice(text.lastIndexOf('\n', offset) + 1).match(/^[\t ]*/)[0]
const unit = () => (/\n\t/.test(text) ? '\t' : '  ')
const j = (v) => JSON.stringify(v).replace(/([,:])(?=["\[{])/g, '$1 ')

// Insert `snippet` as a new member/element of the container at `path`, on its own line(s).
function appendMember(path, snippet) {
	const c = path.length ? node(path) : parseTree(text, [], { allowTrailingComma: true })
	const kids = c.children || []
	if (!kids.length) {
		// Empty container, e.g. {} or []: open it up onto its own lines.
		const ind = indentAt(c.offset)
		const open = text[c.offset], close = text[c.offset + c.length - 1]
		const body = snippet.split('\n').map(l => ind + unit() + l).join('\n')
		text = text.slice(0, c.offset) + `${open}\n${body},\n${ind}${close}` + text.slice(c.offset + c.length)
		return
	}
	const last = kids[kids.length - 1]
	const end = last.offset + last.length
	const ind = indentAt(last.offset)
	const lineEnd = text.indexOf('\n', end)
	let rest = text.slice(end, lineEnd)
	if (!/^\s*,/.test(rest)) rest = ',' + rest
	const body = snippet.split('\n').map(l => ind + l).join('\n')
	text = text.slice(0, end) + rest + '\n' + body + ',' + text.slice(lineEnd)
}

// Append a scalar to an existing array, on the same line as its last element.
function appendToArray(path, v) {
	const arr = node(path)
	if (!arr.children.length) { text = text.slice(0, arr.offset) + `[${j(v)}]` + text.slice(arr.offset + arr.length); return }
	const last = arr.children[arr.children.length - 1]
	const end = last.offset + last.length
	text = text.slice(0, end) + `, ${j(v)}` + text.slice(end)
}

const ensureKey = (parent, key, v) => {
	if (value([...parent, key]) !== undefined) return false
	if (!node(parent)) return null
	appendMember(parent, `${j(key)}: ${j(v)}`); return true
}
const ensureIn = (path, v) => {
	const cur = value(path)
	if (cur === undefined) return null
	if (cur.includes(v)) return false
	appendToArray(path, v); return true
}
const multiline = (key, obj) => `${j(key)}: {\n` + Object.entries(obj).map(([k, v]) => `${unit()}${j(k)}: ${j(v)},`).join('\n') + '\n}'

const log = []
const step = (name, r) => log.push(`${name}: ${r === false ? 'already in place' : r === null ? 'missing parent' : 'added'}`)

// The subnet-router recipe's three policy changes (sample values).
step('tagOwners[tag:example-router]', ensureKey(['tagOwners'], 'tag:example-router', ['autogroup:admin', 'tag:tailscale-admin']))
step('tagOwners[tag:bot] += tag:tailscale-admin', ensureIn(['tagOwners', 'tag:bot'], 'tag:tailscale-admin'))
step('autoApprovers.routes[10.60.0.0/16]', ensureKey(['autoApprovers', 'routes'], '10.60.0.0/16', ['tag:example-router']))
if (value(['groups']) === undefined) { appendMember([], multiline('groups', { 'group:db-operators': ['user@example.com'] })); step('groups block', true) }
else step('groups[group:db-operators]', ensureKey(['groups'], 'group:db-operators', ['user@example.com']))
const grant = { src: ['group:db-operators'], dst: ['10.60.0.0/16'], ip: ['tcp:5432'] }
if ((value(['grants']) || []).some(g => JSON.stringify(g) === JSON.stringify(grant))) step('grant', false)
else { appendMember(['grants'], j(grant)); step('grant', true) }

process.stderr.write(log.join('\n') + '\n')
process.stdout.write(text)
