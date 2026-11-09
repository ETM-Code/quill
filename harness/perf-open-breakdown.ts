// Where does "open a large doc" time go? Runs inside the built app (webkit, mocked Tauri).
// Usage: bun harness/perf-open-breakdown.ts [--dist=<dir>] [--doc=large]
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, existsSync } from 'node:fs'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHARED = '/Users/eoghancollins/.claude/tools/playwright/node_modules/playwright/index.mjs'
const { webkit } = await import(existsSync(SHARED) ? SHARED : 'playwright')
const arg = (k: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1]
const PORT = 1434, BASE = `http://localhost:${PORT}`
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
const stripMath = (s: string) => s.replace(/\$\$[\s\S]*?\$\$/g, 'math').replace(/\$[^$\n]+\$/g, 'm')
const stripCode = (s: string) => s.replace(/```[\s\S]*?```/g, 'code')
const stripTables = (s: string) => s.replace(/^\|.*\|\s*$/gm, 'row')
const variants: Record<string, string> = {
  full: DOC, noMath: stripMath(DOC), noCode: stripCode(DOC), noTables: stripTables(DOC),
  proseOnly: stripTables(stripCode(stripMath(DOC))),
}
const res = await page.evaluate(async (v: Record<string, string>) => {
  const { editor, setMarkdown } = (window as any).quillDebug
  const raf = () => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())))
  const out: any = {}
  for (const [name, md] of Object.entries(v)) {
    const runs: any[] = []
    for (let i = 0; i < 5; i++) {
      editor.commands.clearContent(true); await raf()
      const t0 = performance.now()
      const json = editor.markdown.parse(md)             // single parse (unchunked), to isolate marked+tiptap-markdown
      const t1 = performance.now()
      const doc = editor.schema.nodeFromJSON(json)        // JSON -> PM nodes (schema validation)
      const t2 = performance.now()
      editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, doc.content)) // state + DOM build (nodeviews, katex)
      const t3 = performance.now()
      await raf()
      const t4 = performance.now()                        // style/layout/paint
      runs.push({ parse: t1 - t0, schema: t2 - t1, domBuild: t3 - t2, layoutPaint: t4 - t3 })
    }
    const med = (k: string) => runs.map(r => r[k]).sort((a, b) => a - b)[2]
    out[name] = { bytes: md.length, parse: med('parse'), schema: med('schema'), domBuild: med('domBuild'), layoutPaint: med('layoutPaint') }
  }
  // the app's real path for comparison
  const runs: number[] = []
  for (let i = 0; i < 5; i++) { editor.commands.clearContent(true); await raf(); const t0 = performance.now(); setMarkdown(v.full); await raf(); runs.push(performance.now() - t0) }
  out.appPath_setMarkdown_to_paint = runs.sort((a, b) => a - b)[2]
  // DOM weight
  out.dom = { all: document.querySelectorAll('.tiptap *').length, options: document.querySelectorAll('.tiptap option').length, codeBlocks: document.querySelectorAll('.code-block').length, katex: document.querySelectorAll('.tiptap .katex').length, katexNodes: [...document.querySelectorAll('.tiptap .katex')].reduce((a, e) => a + e.querySelectorAll('*').length, 0) }
  return out
}, variants)
for (const [k, v] of Object.entries(res)) console.log(k.padEnd(34), JSON.stringify(v, (_, x) => typeof x === 'number' ? Math.round(x) : x))
await browser.close(); server.kill(); process.exit(0)
