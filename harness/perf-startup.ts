// Startup phase timing in WebKit against a built dist (vite preview).
// Usage: bun harness/perf-startup.ts [runs] [--block=<substring>] [--doc=small|medium|large] [--dist=<dir>]
// Phases (ms since navigationStart): script response end, DOMContentLoaded start,
// editor DOM ('.tiptap') inserted, window.show invoked (mock).
import { spawn, type ChildProcess } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, existsSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHARED = '/Users/eoghancollins/.claude/tools/playwright/node_modules/playwright/index.mjs'
const { webkit } = await import(existsSync(SHARED) ? SHARED : 'playwright')
const arg = (k: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1]
const RUNS = Number(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 8)
const BLOCK = arg('block'), DOC = arg('doc'), DIST = arg('dist')
const PORT = Number(arg('port') ?? 1433)
const BASE = `http://localhost:${PORT}`
const MOCK = readFileSync(join(ROOT, 'harness', 'tauri-mock.js'), 'utf8')
const files: Record<string, string> = {}
for (const n of ['small', 'medium', 'large']) files[`/m/${n}.md`] = readFileSync(join(ROOT, 'tmp-test-files', `${n}.md`), 'utf8')
const seed = { files, dialog: {} }

const server: ChildProcess = spawn('node', [join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort', ...(DIST ? ['--outDir', DIST] : [])], { cwd: ROOT, stdio: 'ignore' })
for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE, { signal: AbortSignal.timeout(500) })).ok) break } catch {} await new Promise(r => setTimeout(r, 250)) }
const served = await (await fetch(BASE)).text()
console.log('serving:', (await fetch(BASE + '/').then(r => r.text()).then(t => /assets\/(index-[^"]+\.js)/.exec(t)?.[1])) ?? served.slice(0, 80))
process.on('exit', () => server.kill())
const browser = await webkit.launch()
const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
const rows: Record<string, number[]> = {}
for (let i = 0; i < RUNS + 1; i++) {   // first run discarded (warm disk/JIT of the browser itself)
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } })
  await ctx.addInitScript(`window.__QUILL_MOCK_SEED__ = ${JSON.stringify(seed)};\n${MOCK}`)
  await ctx.addInitScript(() => {
    const T: Record<string, number> = ((window as any).__T = {})
    document.addEventListener('DOMContentLoaded', () => { T.dclStart = performance.now() }, true)
    new MutationObserver((_, ob) => { if (document.querySelector('.tiptap')) { T.editorDom = performance.now(); ob.disconnect() } }).observe(document, { childList: true, subtree: true })
    const iv = setInterval(() => { const m = (window as any).__QUILL_MOCK__; if (m?.windowVisible) { T.shown = performance.now(); clearInterval(iv) } }, 1)
  })
  if (BLOCK) await ctx.route(u => u.href.includes(BLOCK), r => r.abort())
  const page = await ctx.newPage()
  const url = DOC ? `${BASE}/?open=${encodeURIComponent(`/m/${DOC}.md`)}` : BASE
  await page.goto(url, { waitUntil: 'commit' })
  await page.waitForFunction(() => (window as any).__T?.shown, undefined, { timeout: 60000, polling: 5 })
  const r = await page.evaluate(() => {
    const T = (window as any).__T
    const main = performance.getEntriesByType('resource').find(e => /assets\/index-.*\.js/.test(e.name)) as PerformanceResourceTiming
    const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
    return { scriptRespEnd: main.responseEnd, dclStart: T.dclStart, editorDom: T.editorDom, shown: T.shown, domInteractive: n.domInteractive }
  })
  if (i > 0) for (const [k, v] of Object.entries(r)) (rows[k] ??= []).push(v)
  await ctx.close()
}
console.log(`runs=${RUNS} block=${BLOCK ?? '-'} doc=${DOC ?? 'empty'}`)
const derived = {
  'script eval (dclStart - scriptRespEnd)': rows.dclStart.map((v, i) => v - rows.scriptRespEnd[i]),
  'createEditor+UI (editorDom - dclStart)': rows.editorDom.map((v, i) => v - rows.dclStart[i]),
  'rest to show (shown - editorDom)': rows.shown.map((v, i) => v - rows.editorDom[i]),
}
for (const [k, v] of Object.entries({ ...rows, ...derived })) console.log(k.padEnd(42), 'median', med(v).toFixed(0).padStart(5), ' min', Math.min(...v).toFixed(0).padStart(5), ' max', Math.max(...v).toFixed(0).padStart(5))
await browser.close(); server.kill(); process.exit(0)
