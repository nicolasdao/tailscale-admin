#!/usr/bin/env node
// Read-only live test: every curated read command, plus validate, preview and a recipe dry run,
// against the real tailnet. Writes nothing (no --apply anywhere). Exit 0 = all passed.
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TSA = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tsa.mjs')
const results = []

function tsa(args, { allowExit = [] } = {}) {
	let out
	try {
		out = execFileSync(process.execPath, [TSA, ...args], { encoding: 'utf8' })
	} catch (e) {
		if (!allowExit.includes(e.status)) throw new Error(`exit ${e.status}: ${(e.stdout || '').slice(0, 400)}`)
		out = e.stdout
	}
	if (/tskey-(?!\[REDACTED\])[a-z]+-[A-Za-z0-9]/.test(out)) throw new Error('output contains a credential-shaped string')
	return JSON.parse(out)
}

async function check(name, fn) {
	try {
		const detail = await fn()
		results.push({ name, pass: true, detail })
	} catch (e) {
		results.push({ name, pass: false, detail: e.message })
	}
}

const expect = (cond, msg) => { if (!cond) throw new Error(msg) }

await check('auth check', () => { const r = tsa(['auth', 'check']); expect(r.ok && r.grantedScopes, 'no scopes'); return r.grantedScopes })
let policyText
await check('policy get', () => { const r = tsa(['policy', 'get']); expect(r.ok && r.etag, 'no etag'); return Object.keys(r.sections).join(',') })
await check('policy get --raw', () => { const r = tsa(['policy', 'get', '--raw']); policyText = r.hujson; expect(policyText?.length > 0, 'empty'); return `${policyText.length} bytes` })
await check('policy validate (current policy)', async () => {
	const fs = await import('node:fs')
	const f = path.join(os.tmpdir(), `tsa-validate-${process.pid}.hujson`)
	fs.writeFileSync(f, policyText, { mode: 0o600 })
	try { const r = tsa(['policy', 'validate', '--file', f]); expect(r.valid === true, JSON.stringify(r)); return 'valid' } finally { fs.unlinkSync(f) }
})
await check('policy preview', () => { const r = tsa(['policy', 'preview', '--type', 'ipport', '--for', '100.64.0.1:22']); expect(r.ok, 'not ok'); return 'ok' })
let devices
await check('devices list', () => { const r = tsa(['devices', 'list']); devices = r.devices; expect(r.count > 0, 'no devices'); return `${r.count} devices` })
await check('devices list --tag filter', () => { const tag = devices.flatMap(d => d.tags)[0]; if (!tag) return 'skipped (no tags)'; const r = tsa(['devices', 'list', '--tag', tag]); expect(r.devices.every(d => d.tags.includes(tag)), 'filter mismatch'); return `${r.count} with ${tag}` })
await check('devices get', () => { const r = tsa(['devices', 'get', '--device', devices[0].nodeId]); expect(r.device.nodeId === devices[0].nodeId, 'mismatch'); return 'ok' })
await check('routes list', () => { const d = devices.find(x => x.advertisedRoutes?.length) || devices[0]; const r = tsa(['routes', 'list', '--device', d.nodeId]); expect(Array.isArray(r.enabledRoutes), 'no routes array'); return `${r.enabledRoutes.length} enabled` })
await check('routes approve (plan only)', () => { const d = devices.find(x => x.enabledRoutes?.length); if (!d) return 'skipped'; const r = tsa(['routes', 'approve', '--device', d.nodeId, '--cidr', d.enabledRoutes[0]]); expect(r.status === 'already_in_place', r.status); return r.status })
await check('keys list', () => { const r = tsa(['keys', 'list']); expect(r.ok, 'not ok'); return `${r.count} keys` })
await check('users list', () => { const r = tsa(['users', 'list']); expect(r.count > 0, 'no users'); return `${r.count} users` })
await check('dns get', () => { const r = tsa(['dns', 'get']); expect(r.ok, 'not ok'); return 'ok' })
await check('settings get', () => { const r = tsa(['settings', 'get']); expect(r.ok, 'not ok'); return 'ok' })
await check('api list', () => { const r = tsa(['api', 'list']); expect(r.count > 0, 'empty index'); return `${r.count} operations` })
await check('api GET (generic layer)', () => { const r = tsa(['api', 'GET', '/tailnet/-/webhooks']); expect(r.ok && r.httpStatus === 200, 'not 200'); return 'ok' })
await check('api refuses unknown path', () => { const r = tsa(['api', 'GET', '/tailnet/-/nope'], { allowExit: [1] }); expect(r.error?.code === 'unknown_operation', 'not refused'); return 'refused' })
await check('api plans writes without --apply', () => { const r = tsa(['api', 'POST', '/tailnet/-/dns/preferences', '--body', '{"magicDNS":true}']); expect(r.status === 'planned', r.status); return 'planned' })
await check('recipe prepare dry run', () => {
	const out = path.join(os.tmpdir(), `tsa-dry-${process.pid}.key`)
	const r = tsa(['recipe', 'subnet-router', 'prepare', '--tag', 'tag:tsa-dryrun', '--cidr', '10.250.0.0/16', '--port', '5432', '--hostname', 'tsa-dryrun', '--member', 'dryrun@example.com', '--key-out', out])
	expect(r.status === 'planned' && r.steps[0].validated, JSON.stringify(r).slice(0, 300))
	return 'planned + validated'
})
await check('policy replace-rule refuses an unknown rule', () => { const r = tsa(['policy', 'replace-rule', '--from', '{"src":["tsa:none"]}', '--to', '{"src":["tsa:other"]}'], { allowExit: [1] }); expect(r.error?.code === 'policy_rule_not_found', 'not refused'); return 'refused' })
// Policy-independent: whether Tailscale accepts this check depends on the tailnet's rules, so
// either outcome passes as long as Tailscale validated it and nothing was written.
await check('policy ensure-test (plan only, validated by Tailscale)', () => {
	const r = tsa(['policy', 'ensure-test', '--src', 'autogroup:member', '--deny', '100.64.0.1:22'])
	expect((r.status === 'planned' && r.validated) || (r.status === 'refused' && r.validation), JSON.stringify(r).slice(0, 300))
	return r.status
})
await check('self-audit', () => { const r = tsa(['self-audit'], { allowExit: [3] }); return r.status })

for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`)
const failed = results.filter(r => !r.pass).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exitCode = failed ? 1 : 0
