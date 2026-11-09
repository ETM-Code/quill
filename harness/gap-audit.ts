// Markdown coverage + round-trip audit. Run: bun harness/gap-audit.ts
// Writes .agent-logs/roundtrip.txt (per-case input/output/html) and prints a summary.
import { launchQuill, stopDevServer } from './gap-driver'
import { CASES } from './gap-audit-cases'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUT = join(import.meta.dir, '..', '.agent-logs')
mkdirSync(OUT, { recursive: true })

const norm = (s: string) => s.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim()

async function main() {
  const q = await launchQuill({ files: { '/mock/a.md': '' }, open: '/mock/a.md' })
  const { page } = q
  await page.waitForTimeout(800)
  const lines: string[] = []
  const summary: string[] = []
  const json: Array<{ id: string; md: string; out: string; out2: string }> = []
  for (const [id, md] of CASES) {
    const r = await page.evaluate(([m]) => {
      const d = (window as any).quillDebug
      let err = ''
      let out = '', out2 = '', html = '', text = ''
      try {
        d.setMarkdown(m)
        html = d.editor.getHTML()
        text = d.editor.getText()
        out = d.getMarkdown()
        d.setMarkdown(out)
        out2 = d.getMarkdown()
      } catch (e: any) { err = String(e) }
      const pwn = (window as any).__pwn
      return { out, out2, html, text, err, pwn }
    }, [md] as const)
    json.push({ id, md, out: r.out, out2: r.out2 })
    const same = norm(r.out) === norm(md)
    const stable = r.out === r.out2
    summary.push(`${same ? 'SAME ' : 'DIFF '}${stable ? 'stable  ' : 'UNSTABLE'} ${id}${r.err ? '  ERR ' + r.err : ''}${r.pwn ? '  XSS-EXECUTED' : ''}`)
    lines.push(`===== ${id}  [${same ? 'same' : 'DIFF'}${stable ? '' : ', unstable on 2nd pass'}]${r.err ? ' ERR ' + r.err : ''}`)
    lines.push('--- in'); lines.push(md.length > 600 ? md.slice(0, 300) + '...[trunc]' : md)
    lines.push('--- out'); lines.push(r.out.length > 600 ? r.out.slice(0, 300) + '...[trunc]' : r.out)
    if (!stable) { lines.push('--- out2'); lines.push(r.out2.slice(0, 600)) }
    lines.push('--- html'); lines.push(r.html.length > 900 ? r.html.slice(0, 900) + '...[trunc]' : r.html)
    lines.push('')
  }
  writeFileSync(join(OUT, 'roundtrip.txt'), lines.join('\n'))
  writeFileSync(join(OUT, 'roundtrip.json'), JSON.stringify(json))
  writeFileSync(join(OUT, 'roundtrip-summary.txt'), summary.join('\n') + '\n')
  console.log(summary.join('\n'))
  console.log('console errors:', q.consoleErrors.slice(0, 5))
  await q.close()
  stopDevServer()
  process.exit(0)
}
main().catch(e => { console.error(e); stopDevServer(); process.exit(1) })
