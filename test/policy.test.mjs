// Offline tests for the HuJSON policy editor. Run: node --test test/
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { describe, it } from 'node:test'
import { PolicyEditor, parsePolicy, unifiedDiff } from '../.agents/skills/tailscale-admin/scripts/lib/policy.mjs'

const fixture = (name) => fs.readFileSync(new URL(`./fixtures/policy/${name}`, import.meta.url), 'utf8')
const commentLines = (t) => t.split('\n').filter(l => /\/\/|\/\*|\*\//.test(l))

// The subnet-router recipe's policy edits, as `recipe subnet-router prepare` runs them.
function recipe(ed) {
	ed.ensureTagOwner('tag:example-router', ['autogroup:admin', 'tag:tailscale-admin'])
	ed.ensureRouteApprover('10.60.0.0/16', ['tag:example-router'])
	ed.ensureGroupMembers('group:db-operators', ['user@example.com'])
	ed.ensureAccessRule(['group:db-operators'], ['10.60.0.0/16'], ['5432'])
}
const TOUCHED = ['tagOwners', 'autoApprovers', 'groups', 'grants', 'acls']

describe('policy editor: grants policy with comments', () => {
	const original = fixture('sample-grants.hujson')

	it('keeps every comment and every original line, in order', () => {
		const ed = new PolicyEditor(original)
		recipe(ed)
		ed.verify(TOUCHED)
		assert.deepEqual(commentLines(ed.text), commentLines(original))
		// Every original line survives verbatim, except lines extended in place.
		const out = ed.text.split('\n')
		let pos = 0
		for (const line of original.split('\n')) {
			const idx = out.indexOf(line, pos)
			assert.ok(idx !== -1 || out.some(l => l.startsWith(line.replace(/[\]},\s]*$/, ''))), `lost line: ${line}`)
			if (idx !== -1) pos = idx + 1
		}
	})

	it('produces the intended semantics and leaves untouched sections identical', () => {
		const ed = new PolicyEditor(original)
		recipe(ed)
		const before = parsePolicy(original), after = parsePolicy(ed.text)
		assert.deepEqual(after.ssh, before.ssh)
		assert.deepEqual(after.tagOwners['tag:example-router'], ['autogroup:admin', 'tag:tailscale-admin'])
		assert.deepEqual(after.autoApprovers.routes['10.60.0.0/16'], ['tag:example-router'])
		assert.deepEqual(after.groups['group:db-operators'], ['user@example.com'])
		assert.deepEqual(after.grants.at(-1), { src: ['group:db-operators'], dst: ['10.60.0.0/16'], ip: ['tcp:5432'] })
	})

	it('is idempotent: a second run changes nothing', () => {
		const first = new PolicyEditor(original)
		recipe(first)
		const second = new PolicyEditor(first.text)
		recipe(second)
		assert.equal(second.changed, false)
		assert.equal(second.text, first.text)
	})

	it('appends an owner to an existing tag without touching the rest of the line', () => {
		const ed = new PolicyEditor(original)
		ed.ensureTagOwner('tag:web', ['tag:tailscale-admin'])
		assert.match(ed.text, /"tag:web": {4}\["autogroup:admin", "tag:tailscale-admin"\], \/\/ web servers/)
	})

	it('removal of an added entry restores the original bytes', () => {
		const ed = new PolicyEditor(original)
		ed.ensureTagOwner('tag:example-router', ['autogroup:admin'])
		ed.ensureRouteApprover('10.60.0.0/16', ['tag:example-router'])
		ed.ensureAccessRule(['autogroup:admin'], ['10.60.0.0/16'], ['5432'])
		const back = new PolicyEditor(ed.text)
		back.removeTagOwner('tag:example-router')
		back.removeRouteApprover('10.60.0.0/16')
		back.removeAccessRule(['autogroup:admin'], ['10.60.0.0/16'], ['5432'])
		back.verify(TOUCHED)
		assert.equal(back.text, original)
	})

	it('refuses to remove an entry that shares its line with a comment', () => {
		const ed = new PolicyEditor(original)
		assert.throws(() => ed.removeTagOwner('tag:web'), /shares its line/)
	})

	it('the guard rejects an unexpected change to an untouched section', () => {
		const ed = new PolicyEditor(original)
		ed.text = ed.text.replace('"autogroup:nonroot"', '"root"')
		assert.throws(() => ed.verify(TOUCHED), /changed unexpectedly/)
	})
})

describe('policy editor: other shapes', () => {
	it('acls policy, two-space indent, no trailing commas, one-line object', () => {
		const ed = new PolicyEditor(fixture('sample-acls.hujson'))
		recipe(ed)
		ed.verify(TOUCHED)
		const p = parsePolicy(ed.text)
		assert.deepEqual(p.acls.at(-1), { action: 'accept', src: ['group:db-operators'], dst: ['10.60.0.0/16:5432'] })
		assert.deepEqual(Object.keys(p.tagOwners), ['tag:web', 'tag:example-router'])
		assert.ok(ed.text.includes('// Legacy ACL syntax'))
	})

	it('minimal policy: creates missing sections and fills an empty array', () => {
		const ed = new PolicyEditor(fixture('sample-minimal.hujson'))
		recipe(ed)
		ed.verify(TOUCHED)
		const p = parsePolicy(ed.text)
		assert.equal(p.grants.length, 1)
		assert.ok(p.autoApprovers.routes['10.60.0.0/16'])
		const again = new PolicyEditor(ed.text)
		recipe(again)
		assert.equal(again.changed, false)
	})

	it('refuses to add a plain rule when every grant uses via', () => {
		const ed = new PolicyEditor(fixture('sample-via.hujson'))
		assert.throws(() => ed.ensureAccessRule(['group:x'], ['10.60.0.0/16'], ['5432']), /via/)
	})

	it('rejects a file that does not parse', () => {
		assert.throws(() => new PolicyEditor('{ "grants": [ }'), /does not parse/)
	})

	it('duplicate members are not added twice', () => {
		const ed = new PolicyEditor(fixture('sample-grants.hujson'))
		ed.ensureTagOwner('tag:bot', ['autogroup:admin'])
		assert.equal(ed.changed, false)
	})
})

describe('unified diff', () => {
	it('emits hunks with headers and only +/- for changed lines', () => {
		const d = unifiedDiff('a\nb\nc\n', 'a\nb\nx\nc\n', 'p')
		assert.match(d, /^--- a\/p\n\+\+\+ b\/p\n@@ -1,4 \+1,5 @@/)
		assert.ok(d.includes('\n+x'))
	})
})
