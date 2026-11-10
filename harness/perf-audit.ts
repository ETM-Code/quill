// Speed audit against the production build (vite preview) in WebKit.
// Run: bun run build && bun harness/perf-audit.ts   (needs tmp-test-files from harness/gen-docs.ts)
// Uses the shared Playwright install if the repo's WebKit build is missing.
import { spawn, type ChildProcess } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, existsSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHARED = '/Users/eoghancollins/.claude/tools/playwright/node_modules/playwright/index.mjs'
const { webkit } = await import(existsSync(SHARED) ? SHARED : 'playwright')
const PORT = Number(process.env.PORT ?? 1432)
const BASE = `http://localhost:${PORT}`
const MOCK = readFileSync(join(ROOT, 'harness', 'tauri-mock.js'), 'utf8')
const docs: Record<string, string> = {}
for (const n of ['small', 'medium', 'large']) docs[n] = readFileSync(join(ROOT, 'tmp-test-files', `${n}.md`), 'utf8')
const seed = { files: Object.fromEntries(Object.entries(docs).map(([k, v]) => [`/m/${k}.md`, v])), dialog: {} }
const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
const fmt = (a: number[]) => `median ${med(a).toFixed(0)}ms [${a.map(x => x.toFixed(0)).join(', ')}]`

let server: ChildProcess
async function up() { try { return (await fetch(BASE, { signal: AbortSignal.timeout(800) })).ok } catch { return false } }

server = spawn('node', [join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' })
for (let i = 0; i < 60 && !(await up()); i++) await new Promise(r => setTimeout(r, 250))
const served = await (await fetch(BASE)).text()
console.log('serving:', (await fetch(BASE + '/').then(r => r.text()).then(t => /assets\/(index-[^"]+\.js)/.exec(t)?.[1])) ?? served.slice(0, 80))
process.on('exit', () => server.kill())
const browser = await webkit.launch()
async function fresh() {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } })
  await ctx.addInitScript(`window.__QUILL_MOCK_SEED__ = ${JSON.stringify(seed)};\n${MOCK}`)
  return { ctx, page: await ctx.newPage() }
}
const out: Record<string, unknown> = {}

// 1. startup, empty doc
{
  const t: number[] = [], dcl: number[] = [], load: number[] = [], res: any[] = []
  for (let i = 0; i < 6; i++) {
    const { ctx, page } = await fresh()
    const t0 = Date.now()
    await page.goto(BASE, { waitUntil: 'load' })
    await page.waitForFunction(() => (window as any).__QUILL_MOCK__?.windowVisible === true)
    t.push(Date.now() - t0)
    const nav = await page.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
      const r = performance.getEntriesByType('resource').map(e => ({ n: e.name.replace(location.origin, ''), d: Math.round(e.duration), s: (e as PerformanceResourceTiming).decodedBodySize, st: Math.round(e.startTime) }))
      return { dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd, res: r }
    })
    dcl.push(nav.dcl); load.push(nav.load)
    if (i === 5) res.push(...nav.res)
    await ctx.close()
  }
  console.log('empty: goto -> window.show invoked:', fmt(t))
  console.log('empty: DOMContentLoaded end:', fmt(dcl), ' load end:', fmt(load))
  console.log('startup resources (last run, name/dur/start/bytes):')
  for (const r of res) console.log('  ', r.n, `dur=${r.d}ms start=${r.st}ms decoded=${r.s}`)
}

// 2. open docs via ?open=
for (const name of ['small', 'medium', 'large']) {
  const t: number[] = []
  for (let i = 0; i < 5; i++) {
    const { ctx, page } = await fresh()
    const t0 = Date.now()
    await page.goto(`${BASE}/?open=${encodeURIComponent(`/m/${name}.md`)}`)
    await page.waitForFunction(() => (window as any).__QUILL_MOCK__?.windowVisible === true, undefined, { timeout: 60000 })
    t.push(Date.now() - t0)
    await ctx.close()
  }
  console.log(`cold open ${name} (${Math.round(docs[name].length / 1024)}KB) -> window.show: ${fmt(t)}`)
}

// 3. in-app open of each doc into a running editor: breakdown
{
  const { ctx, page } = await fresh()
  await page.goto(BASE)
  await page.waitForSelector('.tiptap')
  for (const name of ['small', 'medium', 'large', 'large']) {
    const r = await page.evaluate(async (md: string) => {
      const { editor } = (window as any).quillDebug
      const raf = () => new Promise<void>(res => requestAnimationFrame(() => requestAnimationFrame(() => res())))
      editor.commands.clearContent(true); await raf()
      const t0 = performance.now()
      const json = editor.markdown.parse(md)               // whole-doc single parse (no chunking)
      const t1 = performance.now()
      ;(window as any).quillDebug.setMarkdown(md)          // app path: chunked parse + normalize + setContent + grammar scan
      const t2 = performance.now()
      await raf()
      const t3 = performance.now()
      let nodes = 0; editor.state.doc.descendants(() => { nodes++; return true })
      return { singleParse: t1 - t0, setMarkdownSync: t2 - t1, toPaint: t3 - t2, domNodes: document.querySelectorAll('.tiptap *').length, pmNodes: nodes, katex: document.querySelectorAll('.katex').length, blocks: json.content?.length }
    }, docs[name])
    console.log(`in-app open ${name}:`, JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v) : v]))))
  }
  // 4. typing latency via real key events on the large doc: keydown timestamp -> next paint
  async function typing(label: string, where: 'start' | 'middle' | 'end') {
    await page.evaluate((w: string) => {
      const { editor } = (window as any).quillDebug
      const size = editor.state.doc.content.size
      editor.commands.focus(w === 'start' ? 1 : w === 'end' ? 'end' : editor.state.doc.resolve(Math.floor(size / 2)).start() )
      const el = document.querySelector('.tiptap') as HTMLElement
      el.focus()
      ;(window as any).__lat = []
      document.addEventListener('keydown', e => {
        const t0 = e.timeStamp
        requestAnimationFrame(() => setTimeout(() => (window as any).__lat.push(performance.now() - t0), 0))
      }, true)
    }, where)
    if (where === 'middle') {
      // put caret in a paragraph near the middle
      await page.evaluate(() => {
        const ps = document.querySelectorAll('.tiptap > p')
        const p = ps[Math.floor(ps.length / 2)] as HTMLElement
        p.scrollIntoView(); const r = document.createRange(); r.selectNodeContents(p); r.collapse(false)
        const s = getSelection()!; s.removeAllRanges(); s.addRange(r)
      })
    }
    for (let i = 0; i < 40; i++) { await page.keyboard.type('a'); await page.waitForTimeout(25) }
    await page.waitForTimeout(200)
    const lat: number[] = await page.evaluate(() => (window as any).__lat)
    const s = [...lat].sort((a, b) => a - b)
    console.log(`typing ${label} (${where}): n=${lat.length} median=${s[Math.floor(s.length / 2)].toFixed(1)}ms p95=${s[Math.floor(s.length * 0.95)].toFixed(1)}ms max=${s[s.length - 1].toFixed(1)}ms`)
  }
  await typing('large', 'start')
  await typing('large', 'middle')
  await typing('large', 'end')

  // 5. scroll smoothness over large doc: frame intervals during programmatic scrolling
  const scroll = await page.evaluate(async () => {
    const sc = document.querySelector('#editor-container') as HTMLElement
    sc.scrollTop = 0
    const frames: number[] = []; let last = performance.now()
    let run = true
    const loop = (t: number) => { frames.push(t - last); last = t; if (run) requestAnimationFrame(loop) }
    requestAnimationFrame(loop)
    const total = sc.scrollHeight - sc.clientHeight
    const dur = 3000, t0 = performance.now()
    await new Promise<void>(res => { const step = () => { const p = (performance.now() - t0) / dur; sc.scrollTop = total * Math.min(1, p); p < 1 ? requestAnimationFrame(step) : res() }; requestAnimationFrame(step) })
    run = false
    const s = frames.slice(2).sort((a, b) => a - b)
    return { scrollHeight: sc.scrollHeight, frames: s.length, medianFrame: s[Math.floor(s.length / 2)], p95: s[Math.floor(s.length * 0.95)], max: s[s.length - 1], over33: s.filter(x => x > 33).length }
  })
  console.log('scroll large doc 3s:', JSON.stringify(scroll))
  await ctx.close()
}
await browser.close(); server.kill(); process.exit(0)
