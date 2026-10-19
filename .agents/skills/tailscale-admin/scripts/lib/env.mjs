// Credential loading. Follows the HappySkills configuration contract:
// ambient env var > project skills-config.json envFile > global ~/.agents envFile > default secrets path.
// Secret values are returned to the caller only; nothing here prints them.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { TsaError } from './out.mjs'

export const SKILL_KEY = 'nicolasdao/tailscale-admin'
const NAME = 'tailscale-admin'
export const SECRET_NAMES = ['TAILSCALE_OAUTH_CLIENT_ID', 'TAILSCALE_OAUTH_CLIENT_SECRET']

// Nearest directory holding skills-config.json or skills-lock.json, stopping at a .git boundary.
function findProjectRoot(start) {
	let dir = path.resolve(start)
	for (;;) {
		if (fs.existsSync(path.join(dir, 'skills-config.json')) || fs.existsSync(path.join(dir, 'skills-lock.json'))) return dir
		if (fs.existsSync(path.join(dir, '.git'))) return dir
		const up = path.dirname(dir)
		if (up === dir) return null
		dir = up
	}
}

// Absent → null (nothing configured). Present but unparseable → throw: never treat corrupt as empty.
function readConfig(file) {
	if (!fs.existsSync(file)) return null
	try {
		return JSON.parse(fs.readFileSync(file, 'utf8'))
	} catch {
		throw new TsaError('config_corrupt', `${file} exists but is not valid JSON. Run \`npx -y happyskills skills-config validate --json\` and repair it in place (never delete it: it holds every skill's settings).`)
	}
}

export function resolveEnvFile(cwd = process.cwd()) {
	const globalRoot = path.join(os.homedir(), '.agents')
	const projectRoot = findProjectRoot(cwd)
	const candidates = []
	if (projectRoot) {
		const entry = readConfig(path.join(projectRoot, 'skills-config.json'))?.[SKILL_KEY]
		if (entry?.envFile) return path.resolve(projectRoot, entry.envFile)
		candidates.push(path.join(projectRoot, 'secrets', `${NAME}.env`))
	}
	const globalEntry = readConfig(path.join(globalRoot, 'skills-config.json'))?.[SKILL_KEY]
	if (globalEntry?.envFile) return path.resolve(globalRoot, globalEntry.envFile)
	candidates.push(path.join(globalRoot, 'secrets', `${NAME}.env`))
	return candidates.find(f => fs.existsSync(f)) || candidates[0]
}

// Non-secret settings declared in skill.json `config`: author defaults < global < project.
export const CONFIG_DEFAULTS = { tailnet: '-', automationTag: 'tag:tailscale-admin', operatorGroup: 'group:db-operators', keyExpiry: '1d' }

export function loadConfig(cwd = process.cwd()) {
	const projectRoot = findProjectRoot(cwd)
	const globalCfg = readConfig(path.join(os.homedir(), '.agents', 'skills-config.json'))?.[SKILL_KEY]?.config || {}
	const projectCfg = projectRoot ? readConfig(path.join(projectRoot, 'skills-config.json'))?.[SKILL_KEY]?.config || {} : {}
	return { ...CONFIG_DEFAULTS, ...globalCfg, ...projectCfg }
}

function parseEnvFile(file) {
	const vars = {}
	if (!fs.existsSync(file)) return vars
	for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
		const m = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
		if (m) vars[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
	}
	return vars
}

// Returns { values, source, missing }. `values` holds secrets: never log it.
export function loadCredentials() {
	const file = resolveEnvFile()
	const fromFile = parseEnvFile(file)
	const values = {}
	const missing = []
	for (const name of SECRET_NAMES) {
		const v = (process.env[name] || '').trim() || (fromFile[name] || '').trim()
		if (v) values[name] = v
		else missing.push(name)
	}
	return { values, source: file, missing }
}
