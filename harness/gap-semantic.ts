// Compares markdown-it (CommonMark+GFM-ish) HTML of the original vs the Quill-saved markdown
// to separate harmless normalisation from real semantic change as other apps would see it.
// Run after gap-audit.ts: bun harness/gap-semantic.ts
import MarkdownIt from 'markdown-it'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const OUT = join(import.meta.dir, '..', '.agent-logs')
const md = new MarkdownIt({ html: true, linkify: false })
const norm = (h: string) => h.replace(/\s+/g, ' ').replace(/> </g, '><').replace(/<br \/>/g, '<br>').trim()
const rows = JSON.parse(readFileSync(join(OUT, 'roundtrip.json'), 'utf8')) as Array<{ id: string; md: string; out: string }>
const lines: string[] = []
for (const r of rows) {
  const a = norm(md.render(r.md.replace(/\r\n/g, '\n'))), b = norm(md.render(r.out))
  const same = a === b
  lines.push(`${same ? 'SEM-SAME' : 'SEM-DIFF'} ${r.id}`)
  if (!same) { lines.push('   in : ' + a.slice(0, 260)); lines.push('   out: ' + b.slice(0, 260)) }
}
writeFileSync(join(OUT, 'roundtrip-semantic.txt'), lines.join('\n') + '\n')
console.log(lines.join('\n'))
