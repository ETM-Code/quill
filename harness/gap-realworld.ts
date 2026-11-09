// Round-trips real-world .md files (list in .agent-logs/realworld-files.txt) and compares
// markdown-it HTML of original vs saved. Run: bun harness/gap-realworld.ts
import { launchQuill, stopDevServer } from './gap-driver'
import MarkdownIt from 'markdown-it'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const OUT = join(import.meta.dir, '..', '.agent-logs')
const md = new MarkdownIt({ html: true })
const norm = (h: string) => h.replace(/\s+/g, ' ').replace(/> </g, '><').replace(/<br \/>/g, '<br>').replace(/<\/?p>/g, '').replace(/<\/?(ul|ol|li)>/g, m => m).trim()
const files = readFileSync(join(OUT, 'realworld-files.txt'), 'utf8').split('\n').filter(Boolean).map(f => join('/Users/eoghancollins', f))
const q = await launchQuill({ files: { '/mock/a.md': '' }, open: '/mock/a.md' })
await q.page.waitForTimeout(800)
const lines: string[] = []
let same = 0, diff = 0, textDiff = 0
for (const f of files) {
  let src = ''
  try { src = readFileSync(f, 'utf8') } catch { continue }
  const out = await q.page.evaluate((m) => { const d = (window as any).quillDebug; d.setMarkdown(m); return d.getMarkdown() }, src)
  const textOf = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;/g, ' ').replace(/\s+/g, '')
  const a = md.render(src), b = md.render(out)
  const sameHtml = norm(a) === norm(b)
  const sameText = textOf(a) === textOf(b)
  if (sameHtml) same++; else diff++
  if (!sameText) textDiff++
  // find first differing visible-text window
  let hint = ''
  if (!sameText) {
    const ta = textOf(a), tb = textOf(b); let i = 0; while (i < ta.length && ta[i] === tb[i]) i++
    hint = ` | text-diff @${i}: in=${JSON.stringify(ta.slice(Math.max(0, i - 20), i + 40))} out=${JSON.stringify(tb.slice(Math.max(0, i - 20), i + 40))}`
  }
  lines.push(`${sameHtml ? 'SAME' : sameText ? 'STRUCT-DIFF' : 'TEXT-DIFF'} ${f.replace('/Users/eoghancollins/', '')} (${src.length}b)${hint}`)
}
lines.push(`\nsemantically same: ${same}, differs: ${diff} (of which visible-text differs: ${textDiff}) of ${same + diff}`)
writeFileSync(join(OUT, 'realworld-roundtrip.txt'), lines.join('\n') + '\n')
console.log(lines.join('\n'))
await q.close(); stopDevServer(); process.exit(0)
