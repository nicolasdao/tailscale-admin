// Output envelope and errors. Every command prints exactly one JSON object on stdout.

export class TsaError extends Error {
	constructor(code, message, extra = {}) {
		super(message)
		this.code = code
		this.extra = extra
	}
}

// Belt and braces: never let credential-shaped strings reach stdout or stderr.
export const redact = (s) => String(s).replace(/tskey-[A-Za-z0-9]+-[A-Za-z0-9_-]+/g, 'tskey-[REDACTED]')

export function emit(obj) {
	process.stdout.write(redact(JSON.stringify(obj, null, 2)) + '\n')
}

export function fail(err) {
	const body = err instanceof TsaError
		? { ok: false, status: 'error', error: { code: err.code, message: err.message, ...err.extra } }
		: { ok: false, status: 'error', error: { code: 'internal', message: err?.message || String(err) } }
	emit(body)
	process.exitCode = err?.code === 'usage' ? 2 : 1
}

// Result statuses shared by every write command (see SKILL.md "Reading results").
export const STATUS = {
	planned: 'planned',
	applied: 'applied',
	inPlace: 'already_in_place',
	refused: 'refused',
}
