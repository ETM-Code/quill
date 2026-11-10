// Costs of the debounced work after edits on the large doc: serialize (draft/save), word count, grammar scan.
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, existsSync } from 'node:fs'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHARED = '/Users/eoghancollins/.claude/tools/playwright/node_modules/playwright/index.mjs'
const { webkit } = await import(existsSync(SHARED) ? SHARED : 'playwright')
const PORT = 1436, BASE = `http://localhost:${PORT}`
const MOCK = readFileSync(join(ROOT, 'harness', 'tauri-mock.js'), 'utf8')
const DOC = readFileSync(join(ROOT, 'tmp-test-files', 'large.md'), 'utf8')
const server = spawn('node', [join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' })
for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE, { signal: AbortSignal.timeout(500) })).ok) break } catch {} await new Promise(r => setTimeout(r, 250)) }
const served = await (await fetch(BASE)).text()
console.log('serving:', (await fetch(BASE + '/').then(r => r.text()).then(t => /assets\/(index-[^"]+\.js)/.exec(t)?.[1])) ?? served.slice(0, 80))
process.on('exit', () => server.kill())
const browser = await webkit.launch()
const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } })
await ctx.addInitScript(`window.__QUILL_MOCK_SEED__ = {files:{}};\n${MOCK}`)
const page = await ctx.newPage()
await page.goto(BASE); await page.waitForSelector('.tiptap')
const r = await page.evaluate(async (md: string) => {
  const q = (window as any).quillDebug; q.setMarkdown(md)
  await new Promise(r => setTimeout(r, 500))
  const med = (f: () => void, n = 7) => { const a: number[] = []; for (let i = 0; i < n; i++) { const t = performance.now(); f(); a.push(performance.now() - t) } return +a.sort((x, y) => x - y)[Math.floor(n / 2)].toFixed(1) }
  const ed = q.editor
  return {
    serializeMarkdown: med(() => q.getMarkdown()),
    wordCount: med(() => (ed.storage as any).characterCount.words()),
    descendantsScan: med(() => { let n = 0; ed.state.doc.descendants(() => { n++; return true }) }),
    getJSON: med(() => ed.getJSON()),
    docSizeChars: ed.state.doc.textContent.length,
  }
}, DOC)
console.log(JSON.stringify(r))
await browser.close(); server.kill(); process.exit(0)
