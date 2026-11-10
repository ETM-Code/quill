// Runs every UX scenario; exits non-zero on any failure.
// Run: bun harness/ux-all.ts
import type { Result } from './ux/driver'

const suites: Array<[string, () => Promise<{ run: () => Promise<Result[]> }>]> = [
  ['links', () => import('./ux-links')],
  ['images', () => import('./ux-images')],
  ['editing', () => import('./ux-editing')],
  ['tables', () => import('./ux-tables')],
  ['views', () => import('./ux-views')],
]

const all: Result[] = []
for (const [name, load] of suites) {
  console.log(`\n=== ${name}`)
  try {
    all.push(...(await (await load()).run()))
  } catch (e: any) {
    all.push({ name: `${name}: suite crashed`, ok: false, detail: String(e?.stack ?? e) })
    console.log(`FAIL ${name}: suite crashed — ${e?.stack ?? e}`)
  }
}
const failed = all.filter(r => !r.ok)
console.log(`\nUX: ${all.length - failed.length}/${all.length} passed`)
for (const f of failed) console.log(`  FAIL ${f.name}: ${f.detail.slice(0, 200)}`)
process.exit(failed.length ? 1 : 0)
