#!/usr/bin/env node
// tsa: administer a Tailscale tailnet through the official API v2.
// Usage: node tsa.mjs <group> <verb> [--flags]. Every command prints one JSON object.
// Writes print a plan and change nothing unless --apply is given.
import { emit, fail, TsaError } from './lib/out.mjs'
import * as policy from './commands/policy.mjs'
import * as devices from './commands/devices.mjs'
import * as keys from './commands/keys.mjs'
import * as misc from './commands/misc.mjs'
import * as api from './commands/api.mjs'
import * as recipe from './commands/recipe.mjs'
import * as audit from './commands/audit.mjs'

const GROUPS = { auth: misc, users: misc, dns: misc, settings: misc, policy, devices, routes: devices, keys, api, recipe, 'self-audit': audit }

const HELP = `tsa <group> <verb> [flags]      (all output is JSON; writes need --apply)

auth check                                   verify credentials, show granted scopes
policy get [--raw]                           sections summary (or the HuJSON text with --raw)
policy validate --file F                     validate a local HuJSON file (never applies)
policy preview --type user|ipport --for X [--file F]
policy ensure-tag-owner --tag T --owner O... [--apply]
policy ensure-auto-approver --route CIDR --approver A... [--apply]
policy ensure-exit-node-approver --approver A [--apply]
policy ensure-group --group G --member M... [--apply]
policy ensure-rule --src S... --dst CIDR... --port P... [--proto tcp] [--apply]
policy replace-rule --from '<rule JSON>' --to '<rule JSON>' [--comment "new comment"] [--apply]
policy ensure-test --src S [--accept host:port...] [--deny host:port...] [--apply]
policy remove-test --src S [--apply]
policy remove-tag-owner --tag T | remove-auto-approver --route CIDR | remove-rule --src S --dst C --port P   [--apply]
                                             (only entries that sit alone on their own lines)
devices list [--tag T] [--hostname H] [--os O]
devices get --device ID|HOSTNAME
devices key-expiry --device D --disable|--enable [--apply]
devices tags --device D [--add T...] [--remove T...] [--apply]
devices authorize --device D [--apply]
devices delete --device D --confirm D [--apply]
routes list --device D
routes approve --device D --cidr C... [--apply]
routes remove --device D --cidr C... [--apply]
keys list
keys create-auth --tag T... --out FILE [--expiry 1d] [--reusable] [--ephemeral] [--no-preauthorized] [--description S] [--apply]
keys revoke --key ID --confirm ID [--apply]
users list | dns get | settings get
api <METHOD> <path> [--query k=v...] [--body JSON | --body-file F] [--scope S...] [--confirm PATH] [--apply]
api list [--tag T]                           every operation in the bundled index
recipe subnet-router prepare --tag T --cidr C... --port P... --hostname H --key-out FILE [--group G] [--member M...] [--apply]
recipe subnet-router finish --hostname H --cidr C... [--revoke-key] [--apply]
self-audit [--update-index]                  diff the live OpenAPI document against the bundled index

Global: --tailnet <id> (default "-": the credential's own tailnet)`

// Minimal flag parser: --k v, --k=v, bare --flag => true, repeated flags => array.
export function parseArgs(argv) {
	const pos = []
	const flags = {}
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]
		if (!a.startsWith('--')) { pos.push(a); continue }
		let [k, v] = a.slice(2).split(/=(.*)/s)
		if (v === undefined) v = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true
		k = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
		flags[k] = k in flags ? [].concat(flags[k], v) : v
	}
	return { pos, flags }
}

async function main() {
	const { pos, flags } = parseArgs(process.argv.slice(2))
	const [group, ...rest] = pos
	if (!group || group === 'help' || (flags.help && !group)) { process.stdout.write(HELP + '\n'); return }
	const mod = GROUPS[group]
	if (!mod) throw new TsaError('usage', `Unknown group "${group}". Run: node tsa.mjs help`)
	if (flags.help) { process.stdout.write(HELP.split('\n').filter(l => l.startsWith(group) || l.startsWith('Global')).join('\n') + '\n'); return }
	emit(await mod.run(group, rest, flags))
}

main().catch(fail)
