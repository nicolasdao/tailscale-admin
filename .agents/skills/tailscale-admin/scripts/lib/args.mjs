// Flag helpers shared by command modules.
import { loadConfig } from './env.mjs'
import { TsaError } from './out.mjs'

export const list = (v) => (v === undefined || v === true ? [] : [].concat(v).flatMap(x => String(x).split(',')).map(s => s.trim()).filter(Boolean))

export function need(flags, name, hint = '') {
	const v = flags[name]
	if (v === undefined || v === true || (Array.isArray(v) && !v.length)) {
		throw new TsaError('usage', `Missing --${name.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}${hint ? ` ${hint}` : ''}.`)
	}
	return v
}

export const one = (flags, name, hint) => { const v = need(flags, name, hint); return Array.isArray(v) ? v[v.length - 1] : String(v) }

// Destructive operations need --confirm with the exact target.
export function confirmTarget(flags, target) {
	if (flags.confirm !== target) {
		throw new TsaError('confirmation_required', `This is destructive. Re-run with --confirm ${target} (exact match) to proceed.`, { target })
	}
}

// Flag value if given, else the configured value (skills-config.json), else the author default.
export const flagOr = (flags, name, fallback) => (flags[name] !== undefined && flags[name] !== true ? String([].concat(flags[name]).at(-1)) : fallback)

export const opts = (flags) => {
	const config = loadConfig()
	return { tailnet: flagOr(flags, 'tailnet', config.tailnet), apply: flags.apply === true, ifMatch: flags.ifMatch, config }
}
