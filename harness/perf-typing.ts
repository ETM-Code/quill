// Typing latency (keydown -> next paint) and scroll frame times on the large doc.
// Usage: bun harness/perf-typing.ts [--dist=<dir>] [--doc=large] [--keys=60]
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, existsSync } from 'node:fs'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHARED = '/Users/eoghancollins/.claude/tools/playwright/node_modules/playwright/index.mjs'
const { webkit } = await import(existsSync(SHARED) ? SHARED : 'playwright')
const arg = (k: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1]
const PORT = Number(arg('port') ?? 1435), BASE = `http://localhost:${PORT}`
const KEYS = Number(arg('keys') ?? 60)
const MOCK = readFileSync(join(ROOT, 'harness', 'tauri-mock.js'), 'utf8')
const DOC = readFileSync(join(ROOT, 'tmp-test-files', `${arg('doc') ?? 'large'}.md`), 'utf8')
const server = spawn('node', [join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort', ...(arg('dist') ? ['--outDir', arg('dist')!] : [])], { cwd: ROOT, stdio: 'ignore' })
for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE, { signal: AbortSignal.timeout(500) })).ok) break } catch {} await new Promise(r => setTimeout(r, 250)) }
const served = await (await fetch(BASE)).text()
console.log('serving:', (await fetch(BASE + '/').then(r => r.text()).then(t => /assets\/(index-[^"]+\.js)/.exec(t)?.[1])) ?? served.slice(0, 80))
process.on('exit', () => server.kill())
const browser = await webkit.launch()
const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } })
await ctx.addInitScript(`window.__QUILL_MOCK_SEED__ = {files:{}};\n${MOCK}`)
const page = await ctx.newPage()
await page.goto(BASE); await page.waitForSelector('.tiptap')
const t0 = Date.now()
await page.evaluate(async (md: string) => { (window as any).quillDebug.setMarkdown(md); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))) }, DOC)
console.log('load doc (setMarkdown->paint, incl. page.evaluate overhead):', Date.now() - t0, 'ms')
await page.evaluate(() => {
  ;(window as any).__lat = []; (window as any).__disp = []
  { const v = (window as any).quillDebug.editor.view; const d = v.dispatch.bind(v)
    v.dispatch = (tr: any) => { const t = performance.now(); d(tr); (window as any).__disp.push(performance.now() - t) } }
  document.addEventListener('keydown', e => { const t = e.timeStamp; requestAnimationFrame(() => setTimeout(() => (window as any).__lat.push(performance.now() - t), 0)) }, true)
})
async function typing(where: 'start' | 'middle' | 'end') {
  await page.evaluate((w: string) => {
    const ed = document.querySelector('#editor-container') as HTMLElement
    const ps = [...document.querySelectorAll('.tiptap > p')] as HTMLElement[]
    const p = w === 'start' ? ps[0] : w === 'end' ? ps[ps.length - 1] : ps[Math.floor(ps.length / 2)]
    p.scrollIntoView({ block: 'center' })
    const r = document.createRange(); r.selectNodeContents(p); r.collapse(false)
    const s = getSelection()!; s.removeAllRanges(); s.addRange(r)
    ;(document.querySelector('.tiptap') as HTMLElement).focus(); (window as any).__lat = []; (window as any).__disp = []; void ed
  }, where)
  await page.waitForTimeout(150)
  for (let i = 0; i < KEYS; i++) { await page.keyboard.type('a'); await page.waitForTimeout(30) }
  await page.waitForTimeout(200)
  const lat: number[] = await page.evaluate(() => (window as any).__lat)
  const s = [...lat].sort((a, b) => a - b)
  const dsp: number[] = (await page.evaluate(() => (window as any).__disp) as number[]).sort((a, b) => a - b)
  console.log(`  sync dispatch (state.apply+view.update): n=${dsp.length} median=${dsp[Math.floor(dsp.length / 2)].toFixed(2)}ms p95=${dsp[Math.floor(dsp.length * 0.95)].toFixed(2)}ms max=${dsp[dsp.length - 1].toFixed(2)}ms`)
  console.log(`typing @${where}: n=${lat.length} median=${s[Math.floor(s.length / 2)].toFixed(1)}ms p95=${s[Math.floor(s.length * 0.95)].toFixed(1)}ms max=${s[s.length - 1].toFixed(1)}ms`)
}
await typing('start'); await typing('middle'); await typing('end')
const scroll = await page.evaluate(async () => {
  const sc = document.querySelector('#editor-container') as HTMLElement
  sc.scrollTop = 0
  const frames: number[] = []; let last = performance.now(), run = true
  const loop = (t: number) => { frames.push(t - last); last = t; if (run) requestAnimationFrame(loop) }
  requestAnimationFrame(loop)
  const total = sc.scrollHeight - sc.clientHeight, dur = 3000, t0 = performance.now()
  await new Promise<void>(res => { const step = () => { const p = (performance.now() - t0) / dur; sc.scrollTop = total * Math.min(1, p); p < 1 ? requestAnimationFrame(step) : res() }; requestAnimationFrame(step) })
  run = false
  const s = frames.slice(2).sort((a, b) => a - b)
  return { scrollHeight: sc.scrollHeight, frames: s.length, median: +s[Math.floor(s.length / 2)].toFixed(1), p95: +s[Math.floor(s.length * 0.95)].toFixed(1), max: +s[s.length - 1].toFixed(1), over20ms: s.filter(x => x > 20).length }
})
console.log('scroll 3s over doc:', JSON.stringify(scroll))
await browser.close(); server.kill(); process.exit(0)
