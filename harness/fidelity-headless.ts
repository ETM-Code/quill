// Headless fidelity check of the markdown codec (no browser): every corpus
// case, extra cases and real files, in both save modes.
//   preserve: what Quill writes for an opened-then-saved file (must be
//             byte-identical to the input).
//   fresh:    the serializer alone, as if every block had been edited (must
//             keep meaning under the oracle, and be stable on a second pass).
// Usage: bun harness/fidelity-headless.ts [--verbose]   (exit 1 on failure)
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { CASES } from './gap-audit-cases'
import { EXACT, diffHint, sameMeaning } from './fidelity-lib'
import { EXTRA_CASES } from './fidelity-cases'

const { quillSchema } = await import('../src/editor-setup')
const { getCodec } = await import('../src/markdown')

const verbose = process.argv.includes('--verbose')
const schema = quillSchema()
const codec = getCodec(schema)

function fresh(md: string): string {
  return codec.serialize(codec.parse(md).doc, { preserve: false })
}
function preserved(md: string): string {
  const { doc, info } = codec.parse(md)
  return codec.serialize(doc, { load: info })
}

export interface Failure { id: string; mode: string; detail: string }

export function runHeadless(realFiles: string[]): { checked: number; failures: Failure[] } {
  const failures: Failure[] = []
  let checked = 0
  const all: Array<[string, string]> = [...CASES, ...EXTRA_CASES]
  for (const [id, md] of all) {
    checked++
    try {
      const p = preserved(md)
      if (p !== md.replace(/\r\n?/g, '\n')) failures.push({ id, mode: 'preserve', detail: `not byte-identical\n      in : ${JSON.stringify(md.slice(0, 200))}\n      out: ${JSON.stringify(p.slice(0, 200))}` })
      const f1 = fresh(md)
      const f2 = fresh(f1)
      if (!sameMeaning(md, f1)) failures.push({ id, mode: 'fresh', detail: 'meaning changed ' + diffHint(md, f1) + `\n      md : ${JSON.stringify(f1.slice(0, 300))}` })
      if (f1 !== f2) failures.push({ id, mode: 'fresh-2nd-pass', detail: `unstable\n      1: ${JSON.stringify(f1.slice(0, 300))}\n      2: ${JSON.stringify(f2.slice(0, 300))}` })
    } catch (e) {
      failures.push({ id, mode: 'error', detail: String((e as Error).stack ?? e) })
    }
  }
  for (const [id, md, expected] of EXACT) {
    checked++
    const f1 = fresh(md)
    if (f1 !== expected) failures.push({ id, mode: 'exact', detail: `expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(f1)}` })
    if (preserved(md) !== md) failures.push({ id, mode: 'exact-preserve', detail: 'not byte-identical' })
  }
  for (const file of realFiles) {
    if (!existsSync(file)) continue
    checked++
    const md = readFileSync(file, 'utf8')
    const id = file.replace('/Users/eoghancollins/', '~/')
    try {
      const p = preserved(md)
      if (p !== md.replace(/\r\n?/g, '\n')) failures.push({ id, mode: 'preserve', detail: 'not byte-identical' })
      const f1 = fresh(md)
      if (!sameMeaning(md, f1)) failures.push({ id, mode: 'fresh', detail: 'meaning changed ' + diffHint(md, f1) })
      const f2 = fresh(f1)
      if (f1 !== f2) {
        let i = 0
        while (i < f1.length && f1[i] === f2[i]) i++
        failures.push({ id, mode: 'fresh-2nd-pass', detail: `unstable @${i}: ${JSON.stringify(f1.slice(Math.max(0, i - 60), i + 60))} vs ${JSON.stringify(f2.slice(Math.max(0, i - 60), i + 60))}` })
      }
    } catch (e) {
      failures.push({ id, mode: 'error', detail: String((e as Error).stack ?? e) })
    }
  }
  return { checked, failures }
}

export function realWorldFiles(): string[] {
  const list = join(import.meta.dir, 'fixtures', 'realworld-files.txt')
  const fallback = join(import.meta.dir, '..', '.agent-logs', 'realworld-files.txt')
  const path = existsSync(list) ? list : fallback
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map(f => join('/Users/eoghancollins', f))
}

if (import.meta.main) {
  const { checked, failures } = runHeadless(realWorldFiles())
  for (const f of failures) console.log(`FAIL [${f.mode}] ${f.id}${verbose || failures.length < 40 ? '\n      ' + f.detail : ''}`)
  console.log(`\nheadless: ${checked} inputs checked, ${failures.length} failures`)
  process.exit(failures.length ? 1 : 0)
}
