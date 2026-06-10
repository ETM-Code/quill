// Performance measurement against the production build (vite preview).
// Run: bun run build && bun harness/perf.ts
import { spawn, type ChildProcess } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { webkit } from 'playwright'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 1431
const URL_BASE = `http://localhost:${PORT}`
const MOCK = readFileSync(join(ROOT, 'harness', 'tauri-mock.js'), 'utf8')

let server: ChildProcess

async function up(): Promise<boolean> {
  try {
    return (await fetch(URL_BASE, { signal: AbortSignal.timeout(800) })).ok
  } catch {
    return false
  }
}

const LARGE = readFileSync(join(ROOT, 'tmp-test-files', 'large.md'), 'utf8')

async function main() {
  server = spawn('bunx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
  })
  for (let i = 0; i < 40 && !(await up()); i++) await new Promise(r => setTimeout(r, 250))

  const browser = await webkit.launch()
  const seed = { files: { '/m/large.md': LARGE }, dialog: {} }

  async function freshPage() {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } })
    await ctx.addInitScript(`window.__QUILL_MOCK_SEED__ = ${JSON.stringify(seed)};\n${MOCK}`)
    const page = await ctx.newPage()
    return { ctx, page }
  }

  // 1. empty doc: navigation -> editor interactive
  {
    const runs: number[] = []
    for (let i = 0; i < 4; i++) {
      const { ctx, page } = await freshPage()
      const t0 = Date.now()
      await page.goto(URL_BASE)
      await page.waitForSelector('.tiptap')
      runs.push(Date.now() - t0)
      await ctx.close()
    }
    console.log(`empty doc load -> editor ready: ${runs.join(', ')}ms`)
  }

  // 2. large doc via ?open= : navigation -> window shown (content set)
  {
    const runs: number[] = []
    for (let i = 0; i < 3; i++) {
      const { ctx, page } = await freshPage()
      const t0 = Date.now()
      await page.goto(`${URL_BASE}/?open=${encodeURIComponent('/m/large.md')}`)
      await page.waitForFunction(() => (window as any).__QUILL_MOCK__?.windowVisible === true, undefined, { timeout: 60000 })
      runs.push(Date.now() - t0)
      await ctx.close()
    }
    console.log(`large doc (${Math.round(LARGE.length / 1024)}KB) load -> window visible: ${runs.join(', ')}ms`)
  }

  // 3. breakdown: parse vs render
  {
    const { ctx, page } = await freshPage()
    await page.goto(URL_BASE)
    await page.waitForSelector('.tiptap')
    const breakdown = await page.evaluate((md: string) => {
      const editor = (window as any).quillDebug.editor
      const t0 = performance.now()
      const json = editor.markdown.parse(md)
      const t1 = performance.now()
      editor.commands.setContent(json)
      const t2 = performance.now()
      return {
        parse: Math.round(t1 - t0),
        applyAndRender: Math.round(t2 - t1),
        blocks: json.content?.length ?? 0,
      }
    }, LARGE)
    console.log('large doc breakdown:', JSON.stringify(breakdown))
    // typing latency at end of large doc
    await page.evaluate(() => {
      const editor = (window as any).quillDebug.editor
      editor.commands.focus('end')
    })
    const typed = await page.evaluate(() => {
      const editor = (window as any).quillDebug.editor
      const t0 = performance.now()
      for (let i = 0; i < 20; i++) editor.commands.insertContent('x')
      return Math.round(performance.now() - t0)
    })
    console.log(`20 inserts at end of large doc: ${typed}ms (${(typed / 20).toFixed(1)}ms/keystroke)`)
    await ctx.close()
  }

  await browser.close()
  server.kill()
  process.exit(0)
}

main().catch(e => { console.error(e); server?.kill(); process.exit(1) })
