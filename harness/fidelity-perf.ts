// Parse / save timing of the markdown layer on tmp-test-files (200 KB doc).
// bun harness/fidelity-perf.ts   (headless + WebKit app path)
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchQuill, stopDevServer } from './gap-driver'
const { quillSchema } = await import('../src/editor-setup')
const { getCodec } = await import('../src/markdown')
const codec = getCodec(quillSchema())
const med = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]
for (const name of ['small.md', 'medium.md', 'large.md']) {
  const md = readFileSync(join(import.meta.dir, '..', 'tmp-test-files', name), 'utf8')
  const p: number[] = [], s: number[] = [], f: number[] = []
  for (let i = 0; i < 7; i++) {
    let t = performance.now(); const { doc, info } = codec.parse(md); p.push(performance.now() - t)
    t = performance.now(); codec.serialize(doc, { load: info }); s.push(performance.now() - t)
    t = performance.now(); codec.serialize(doc, { preserve: false }); f.push(performance.now() - t)
  }
  console.log(`bun   ${name.padEnd(10)} ${String(md.length).padStart(7)}b parse ${med(p).toFixed(1)}ms  save(unedited) ${med(s).toFixed(1)}ms  save(all edited) ${med(f).toFixed(1)}ms`)
}
const large = readFileSync(join(import.meta.dir, '..', 'tmp-test-files', 'large.md'), 'utf8')
const q = await launchQuill({ files: { '/m/a.md': '' }, open: '/m/a.md' })
await q.page.waitForTimeout(500)
const r = await q.page.evaluate(async (md: string) => {
  const d = (window as any).quillDebug
  const runs: any[] = []
  for (let i = 0; i < 5; i++) {
    d.setMarkdown('')
    await new Promise(r => requestAnimationFrame(() => r(null)))
    const t0 = performance.now()
    d.setMarkdown(md)
    const t1 = performance.now()
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)))
    const t2 = performance.now()
    d.getMarkdown()
    const t3 = performance.now()
    runs.push({ setMarkdown: t1 - t0, toPaint: t2 - t0, getMarkdown: t3 - t2 })
  }
  const pf: number[] = []
  for (let i = 0; i < 5; i++) {
    const t = performance.now(); (window as any).quillMarkdown.serializeFresh(md); pf.push(performance.now() - t)
  }
  const m = (k: string) => runs.map(x => x[k]).sort((a, b) => a - b)[2]
  return { parseAndSerialize: pf.sort((a, b) => a - b)[2], setMarkdown: m('setMarkdown'), toPaint: m('toPaint'), getMarkdown: m('getMarkdown') }
}, large)
console.log(`webkit large.md parse+full serialize ${r.parseAndSerialize.toFixed(0)}ms`)
console.log(`webkit large.md setMarkdown ${r.setMarkdown.toFixed(0)}ms, to paint ${r.toPaint.toFixed(0)}ms, getMarkdown ${r.getMarkdown.toFixed(1)}ms`)
await q.close(); stopDevServer(); process.exit(0)
