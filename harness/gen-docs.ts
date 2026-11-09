// Generates realistic markdown fixtures into tmp-test-files/ (small ~5KB, medium ~50KB, large ~200KB).
// Run: bun harness/gen-docs.ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'tmp-test-files')
mkdirSync(OUT, { recursive: true })

let seed = 42
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)]
const words = 'the quick editor renders markdown with fast parsing lazily loaded grammars and small bundles while keeping typing latency low across large documents because ProseMirror transactions stay cheap when views are incremental'.split(' ')
const sentence = () => {
  const n = 8 + Math.floor(rnd() * 14)
  let s = Array.from({ length: n }, () => pick(words)).join(' ')
  if (rnd() < 0.25) s = s.replace(/(\w+) (\w+)/, '**$1** $2')
  if (rnd() < 0.2) s = s.replace(/(\w+) (\w+)$/, '*$1 $2*')
  if (rnd() < 0.15) s = s.replace(/(\w+)/, '`$1`')
  if (rnd() < 0.15) s += ' [link text](https://example.com/page)'
  if (rnd() < 0.1) s += ' with inline math $E = mc^2 + \\alpha_{i}$'
  return s.charAt(0).toUpperCase() + s.slice(1) + '.'
}
const para = () => Array.from({ length: 2 + Math.floor(rnd() * 4) }, sentence).join(' ')
const langs: Record<string, string> = {
  typescript: 'export function add(a: number, b: number): number {\n  const result = a + b\n  return result\n}\n\nconst xs = [1, 2, 3].map(n => n * 2)\nconsole.log(xs)',
  python: 'def fib(n):\n    a, b = 0, 1\n    for _ in range(n):\n        a, b = b, a + b\n    return a\n\nprint([fib(i) for i in range(10)])',
  rust: 'fn main() {\n    let v: Vec<u32> = (0..10).collect();\n    let s: u32 = v.iter().sum();\n    println!("{s}");\n}',
  bash: 'set -euo pipefail\nfor f in *.md; do\n  echo "$f"\ndone',
  json: '{\n  "name": "quill",\n  "version": "0.1.1",\n  "items": [1, 2, 3]\n}',
  css: '.tiptap p {\n  margin: 0 0 1em;\n  line-height: 1.6;\n}',
}
const code = () => { const l = pick(Object.keys(langs)); return '```' + l + '\n' + langs[l] + '\n```' }
const list = () => Array.from({ length: 3 + Math.floor(rnd() * 4) }, (_, i) => `- ${sentence()}${i === 1 ? '\n  - nested ' + sentence() : ''}`).join('\n')
const olist = () => Array.from({ length: 3 + Math.floor(rnd() * 3) }, (_, i) => `${i + 1}. ${sentence()}`).join('\n')
const tasks = () => Array.from({ length: 3 }, (_, i) => `- [${i === 0 ? 'x' : ' '}] ${sentence()}`).join('\n')
const table = () => {
  const rows = ['| Name | Value | Notes |', '| --- | ---: | --- |']
  for (let i = 0; i < 4 + Math.floor(rnd() * 4); i++) rows.push(`| item ${i} | ${(rnd() * 100).toFixed(2)} | ${sentence().slice(0, 40)} |`)
  return rows.join('\n')
}
const quote = () => '> ' + sentence() + '\n> ' + sentence()
const math = () => '$$\n\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}\n$$'
const blocks = [para, para, para, list, olist, tasks, table, code, quote, math]

function doc(targetBytes: number): string {
  seed = 42
  const out: string[] = ['# Quill performance fixture\n']
  let size = 0, h = 0
  while (size < targetBytes) {
    if (h % 7 === 0) out.push(`\n## Section ${Math.floor(h / 7) + 1}\n`)
    else if (rnd() < 0.3) out.push(`\n### Subsection ${h}\n`)
    h++
    for (let i = 0; i < 4; i++) { const b = pick(blocks)(); out.push(b + '\n'); size += b.length + 2 }
  }
  return out.join('\n')
}
for (const [name, n] of [['small', 5_000], ['medium', 50_000], ['large', 200_000]] as const) {
  const d = doc(n)
  writeFileSync(join(OUT, `${name}.md`), d)
  console.log(name, d.length)
}
