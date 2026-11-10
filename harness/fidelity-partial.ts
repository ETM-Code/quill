// Partial-edit fidelity check. The other modes either keep every block
// verbatim (preserve) or rewrite every block (fresh); this one edits ONE
// textblock (paragraph, heading, table cell, list item, callout, footnote
// body ...) and saves with preservation on, so the edited block is rewritten
// while its siblings' inline source is reused verbatim. For each edit:
//   1. meaning: the saved text means the same under the markdown-it oracle as
//      the fully re-serialized edited doc (same normalisations as the gate);
//   2. isolation: everything outside the edited top-level block is
//      byte-identical to the original source;
//   3. stability: reopening the output and saving again is byte-identical.
import { Transform } from '@tiptap/pm/transform'
import type { Node as PMNode } from '@tiptap/pm/model'
import { diffHint, sameMeaning } from './fidelity-lib'
import { blockSourceOf } from '../src/markdown/source'

const { quillSchema } = await import('../src/editor-setup')
const { getCodec } = await import('../src/markdown')

const schema = quillSchema()
const codec = getCodec(schema)
const MARK = 'QZX'
const CAP = 40

export interface PartialFailure { id: string; mode: string; detail: string }

/** Pick up to `cap` entries spread evenly across the list. */
function spread<T>(xs: T[], cap: number): T[] {
  if (xs.length <= cap) return xs
  const out: T[] = []
  for (let i = 0; i < cap; i++) out.push(xs[Math.floor((i * xs.length) / cap)])
  return out
}

function firstDiff(a: string, b: string): string {
  let i = 0
  while (i < a.length && a[i] === b[i]) i++
  const w = (s: string) => JSON.stringify(s.slice(Math.max(0, i - 50), i + 70))
  return `@${i}\n      want: ${w(a)}\n      got : ${w(b)}`
}

export function runPartial(inputs: Array<[id: string, md: string]>): { checked: number; failures: PartialFailure[] } {
  const failures: PartialFailure[] = []
  let checked = 0
  for (const [id, raw] of inputs) {
    const md = raw.replace(/\r\n?/g, '\n')
    let parsed: ReturnType<typeof codec.parse>
    try { parsed = codec.parse(md) } catch { continue }
    const { doc, info } = parsed
    if (doc.childCount !== info.count) continue
    // Original source of every top-level block, to rebuild the expected frame.
    const srcs: string[] = []
    let ok = true
    for (let i = 0; i < doc.childCount; i++) {
      const b = blockSourceOf(doc.child(i), info)
      if (!b) { ok = false; break }
      srcs.push(b.src)
    }
    if (!ok) continue
    const edits: Array<{ top: number; pos: number; kind: string }> = []
    doc.forEach((child: PMNode, offset: number, top: number) => {
      const visit = (n: PMNode, pos: number, path: string) => {
        if (n.isTextblock) {
          if (n.type.spec.code) return
          edits.push({ top, pos: pos + n.nodeSize - 1, kind: path + n.type.name })
          return
        }
        n.forEach((c, o) => visit(c, pos + 1 + o, path + n.type.name + '>'))
      }
      visit(child, offset, '')
    })
    for (const e of spread(edits, CAP)) {
      checked++
      const label = `${id} block ${e.top} (${e.kind})`
      try {
        const edited = new Transform(doc).insert(e.pos, schema.text(MARK)).doc
        const out = codec.serialize(edited, { load: info })
        const fresh = codec.serialize(edited, { preserve: false })
        if (!out.includes(MARK)) { failures.push({ id: label, mode: 'partial-lost-edit', detail: 'marker missing from output' }); continue }
        // 2. isolation. Blocks, and the separators between untouched blocks,
        // are byte-identical. The serializer normalises the separators that
        // touch the rewritten block (and the head / tail next to it) to plain
        // blank lines, so those only need to be newlines.
        const n = info.count
        let before = ''
        if (e.top > 0) {
          before = info.head
          for (let k = 0; k < e.top; k++) before += srcs[k] + (k < e.top - 1 ? info.seps[k] : '')
        }
        let after = ''
        if (e.top < n - 1) {
          for (let k = e.top + 1; k < n; k++) after += srcs[k] + (k < n - 1 ? info.seps[k] : '')
          after += info.tail
        }
        if (!out.startsWith(before)) failures.push({ id: label, mode: 'partial-before', detail: `text before the edited block changed ${firstDiff(before, out)}` })
        else if (!out.endsWith(after) || out.length < before.length + after.length) failures.push({ id: label, mode: 'partial-after', detail: `text after the edited block changed ${firstDiff(after, out.slice(Math.max(0, out.length - after.length)))}` })
        else {
          const mid = out.slice(before.length, out.length - after.length)
          if ((e.top > 0 && !/^\n+\S/.test(mid)) || (e.top < n - 1 && !/\S\n+$/.test(mid))) failures.push({ id: label, mode: 'partial-separator', detail: `edited block not separated by blank lines: ${JSON.stringify(mid.slice(0, 200))}` })
        }
        // 1. meaning
        if (!sameMeaning(fresh, out)) failures.push({ id: label, mode: 'partial-meaning', detail: `differs from full re-serialization ${diffHint(fresh, out)}\n      block: ${JSON.stringify(out.slice(before.length, Math.max(before.length, out.length - after.length)).slice(0, 300))}` })
        // 3. stability
        const again = codec.parse(out)
        const out2 = codec.serialize(again.doc, { load: again.info })
        if (out2 !== out) failures.push({ id: label, mode: 'partial-unstable', detail: `reopen+save changed the output ${firstDiff(out, out2)}` })
      } catch (err) {
        failures.push({ id: label, mode: 'partial-error', detail: String((err as Error).stack ?? err) })
      }
    }
  }
  return { checked, failures }
}

if (import.meta.main) {
  const { existsSync, readFileSync } = await import('node:fs')
  const { CASES } = await import('./gap-audit-cases')
  const { EXTRA_CASES } = await import('./fidelity-cases')
  const { EXACT } = await import('./fidelity-lib')
  const { realWorldFiles } = await import('./fidelity-headless')
  const inputs: Array<[string, string]> = [
    ...CASES, ...EXTRA_CASES, ...EXACT.map(([id, md]) => [id, md] as [string, string]),
    ...realWorldFiles().filter(existsSync).map(f => [f.replace('/Users/eoghancollins/', '~/'), readFileSync(f, 'utf8')] as [string, string]),
  ]
  const t = Date.now()
  const { checked, failures } = runPartial(inputs)
  for (const f of failures) console.log(`FAIL [${f.mode}] ${f.id}\n      ${f.detail}`)
  console.log(`\npartial: ${checked} edits checked, ${failures.length} failures (${((Date.now() - t) / 1000).toFixed(1)}s)`)
  process.exit(failures.length ? 1 : 0)
}
