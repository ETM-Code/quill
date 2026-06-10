// Verify chunked parse === whole parse on real + tricky docs, then re-measure.
import { spawn, type ChildProcess } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { webkit } from 'playwright'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 1431
const URL_BASE = `http://localhost:${PORT}`
const MOCK = readFileSync(join(ROOT, 'harness', 'tauri-mock.js'), 'utf8')
const LARGE = readFileSync(join(ROOT, 'tmp-test-files', 'large.md'), 'utf8')
const MEDIUM = readFileSync(join(ROOT, 'tmp-test-files', 'medium.md'), 'utf8')

const TRICKY = [
  '# Doc', '',
  '```python', '', 'x = 1', '', '', 'y = 2', '```', '',
  '- item 1', '', '- loose item 2', '',
  '1. one', '', '2. two', '',
  '> quote line', '',
  '| a | b |', '|---|---|', '| 1 | 2 |', '',
  'Inline $x^2$ math and **bold**.', '',
  '$$', 'E=mc^2', '$$', '',
].join('\n').repeat(180)

let server: ChildProcess
async function main() {
  server = spawn('bunx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' })
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(URL_BASE, { signal: AbortSignal.timeout(500) })).ok) break } catch {}
    await new Promise(r => setTimeout(r, 250))
  }
  const browser = await webkit.launch()
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } })
  await ctx.addInitScript(`window.__QUILL_MOCK_SEED__ = {files:{}};\n${MOCK}`)
  const page = await ctx.newPage()
  page.on('console', m => { if (m.type() === 'error') console.log('[err]', m.text()) })
  await page.goto(URL_BASE)
  await page.waitForSelector('.tiptap')

  for (const [name, doc] of [['large.md', LARGE], ['medium.md', MEDIUM], ['tricky', TRICKY]] as const) {
    const res = await page.evaluate((input: string) => {
      const dbg = (window as any).quillDebug
      // whole-document parse through the same editor/schema
      dbg.editor.commands.setContent(input, { contentType: 'markdown' })
      const wholeJson = JSON.stringify(dbg.editor.getJSON())
      dbg.editor.commands.setContent('')
      return { wholeJson, t: 0 }
    }, doc)
    // chunked via the app's real load path
    const res2 = await page.evaluate((input: string) => {
      const dbg = (window as any).quillDebug
      const t0 = performance.now()
      dbg.setMarkdown(input)
      const t1 = performance.now()
      return { json: JSON.stringify(dbg.editor.getJSON()), t: Math.round(t1 - t0) }
    }, doc)
    const equal = res.wholeJson === res2.json
    console.log(`${name} (${Math.round(doc.length / 1024)}KB): chunked-load=${res2.t}ms, identical-to-whole-parse=${equal}`)
    if (!equal) {
      const a = JSON.parse(res.wholeJson).content ?? []
      const b = JSON.parse(res2.json).content ?? []
      console.log(`  whole nodes=${a.length} chunked nodes=${b.length}`)
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) {
          console.log(`  first diff at node ${i}:`)
          console.log('   whole:  ', JSON.stringify(a[i])?.slice(0, 220))
          console.log('   chunked:', JSON.stringify(b[i])?.slice(0, 220))
          break
        }
      }
    }
  }
  await browser.close()
  server.kill()
  process.exit(0)
}
main().catch(e => { console.error(e); server?.kill(); process.exit(1) })
