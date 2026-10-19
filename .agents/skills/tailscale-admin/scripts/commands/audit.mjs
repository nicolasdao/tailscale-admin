// self-audit: compare the live Tailscale OpenAPI document with the bundled index.
// Exit code 3 when anything changed, so a caller can branch on it. --update-index rewrites
// assets/operations.json (a maintenance write to the skill itself; see references/maintenance.md).
import fs from 'node:fs'
import { buildIndex, diffIndex, fetchLiveSpec, INDEX_FILE, loadIndex } from '../lib/spec.mjs'

export async function run(_group, _rest, flags) {
	const bundled = loadIndex()
	const live = buildIndex(await fetchLiveSpec())
	const diff = diffIndex(bundled, live)
	const changed = diff.added.length + diff.removed.length + diff.changed.length
	if (changed && flags.updateIndex) fs.writeFileSync(INDEX_FILE, JSON.stringify(live, null, '\t') + '\n')
	if (changed) process.exitCode = 3
	return {
		ok: true,
		status: changed ? 'drift' : 'up_to_date',
		bundled: { generated: bundled.generated, count: bundled.count },
		live: { count: live.count },
		...diff,
		indexUpdated: !!(changed && flags.updateIndex),
		next: changed ? 'Follow references/maintenance.md: update commands, tests and docs for these operations, then route to happyskills-design and happyskills-publish.' : undefined,
	}
}
