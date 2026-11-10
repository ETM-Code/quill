// Open a document in the already-running editor (built dist, WebKit, mocked Tauri):
// setMarkdown -> next paint, and (when the doc has math) -> every equation typeset.
// Usage: bun harness/perf-open.ts [--dist=<dir>] [--doc=large] [--runs=6] [--port=1437]
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, existsSync } from 'node:fs'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHARED = '/Users/eoghancollins/.claude/tools/playwright/node_modules/playwright/index.mjs'
const { webkit } = await import(existsSync(SHARED) ? SHARED : 'playwright')
const arg = (k: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1]
const DOC = arg('doc') ?? 'large', RUNS = Number(arg('runs') ?? 6), PORT = Number(arg('port') ?? 1437)
const BASE = `http://localhost:${PORT}`
const MOCK = readFileSync(join(ROOT, 'harness', 'tauri-mock.js'), 'utf8')
const md = readFileSync(join(ROOT, 'tmp-test-files', `${DOC}.md`), 'utf8')
const server = spawn('node', [join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort', ...(arg('dist') ? ['--outDir', arg('dist')!] : [])], { cwd: ROOT, stdio: 'ignore' })
process.on('exit', () => server.kill())
for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE, { signal: AbortSignal.timeout(500) })).ok) break } catch {} await new Promise(r => setTimeout(r, 250)) }
const browser = await webkit.launch()
const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
const paint: number[] = [], typeset: number[] = []
for (let i = 0; i < RUNS + 1; i++) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } })
  await ctx.addInitScript(`window.__QUILL_MOCK_SEED__ = ${JSON.stringify({ files: {}, dialog: {} })};\n${MOCK}`)
  const page = await ctx.newPage()
  await page.goto(BASE)
  await page.waitForFunction(() => (window as any).quillDebug?.editor, undefined, { timeout: 60000 })
  const r = await page.evaluate(async (text: string) => {
    const t0 = performance.now()
    ;(window as any).quillDebug.setMarkdown(text)
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    const tPaint = performance.now() - t0
    const want = document.querySelectorAll('[data-type="inline-math"],[data-type="block-math"]').length
    while (want && document.querySelectorAll('.tiptap .katex').length < want && performance.now() - t0 < 20000) await new Promise(r => setTimeout(r, 5))
    return { tPaint, tTypeset: performance.now() - t0, want }
  }, md)
  if (i > 0) { paint.push(r.tPaint); typeset.push(r.tTypeset) }
  await ctx.close()
}
console.log(`doc=${DOC} runs=${RUNS} setMarkdown->paint median ${med(paint).toFixed(0)} ms (min ${Math.min(...paint).toFixed(0)}, max ${Math.max(...paint).toFixed(0)}); ->all math typeset median ${med(typeset).toFixed(0)} ms (min ${Math.min(...typeset).toFixed(0)}, max ${Math.max(...typeset).toFixed(0)})`)
await browser.close(); server.kill()
