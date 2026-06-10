// Pinpoint the markdown parse hotspot: scaling behavior + marked-only baseline.
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

let server: ChildProcess

async function main() {
  server = spawn('bunx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' })
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(URL_BASE, { signal: AbortSignal.timeout(500) })).ok) break } catch {}
    await new Promise(r => setTimeout(r, 250))
  }

  const browser = await webkit.launch()
  const ctx = await browser.newContext()
  await ctx.addInitScript(`window.__QUILL_MOCK_SEED__ = {files:{}};\n${MOCK}`)
  const page = await ctx.newPage()
  await page.goto(URL_BASE)
  await page.waitForSelector('.tiptap')

  for (const frac of [0.125, 0.25, 0.5, 1]) {
    const md = LARGE.slice(0, Math.floor(LARGE.length * frac))
    const res = await page.evaluate((input: string) => {
      const editor = (window as any).quillDebug.editor
      const m = editor.markdown
      // marked lexer alone
      const t0 = performance.now()
      const tokens = m.instance.lexer(input)
      const t1 = performance.now()
      m.parse(input)
      const t2 = performance.now()
      return { lex: Math.round(t1 - t0), full: Math.round(t2 - t1), tokens: tokens.length }
    }, md)
    console.log(`${Math.round(md.length / 1024)}KB: lex=${res.lex}ms, parse(after lex)=${res.full}ms, topTokens=${res.tokens}`)
  }

  // Chunked parse: split on blank lines outside fences, parse chunks separately
  const res = await page.evaluate((input: string) => {
    const editor = (window as any).quillDebug.editor
    const m = editor.markdown
    const t0 = performance.now()
    const lines = input.split('\n')
    const chunks: string[] = []
    let buf: string[] = []
    let inFence = false
    let blocks = 0
    for (const line of lines) {
      if (/^(```|~~~)/.test(line)) inFence = !inFence
      buf.push(line)
      if (!inFence && line.trim() === '') {
        blocks++
        if (blocks >= 40) {
          chunks.push(buf.join('\n'))
          buf = []
          blocks = 0
        }
      }
    }
    if (buf.length) chunks.push(buf.join('\n'))
    const content: unknown[] = []
    for (const chunk of chunks) {
      const json = m.parse(chunk)
      if (json?.content) content.push(...json.content)
    }
    const t1 = performance.now()
    return { chunked: Math.round(t1 - t0), chunks: chunks.length, nodes: content.length }
  }, LARGE)
  console.log(`chunked parse of full doc: ${res.chunked}ms across ${res.chunks} chunks (${res.nodes} nodes)`)

  await browser.close()
  server.kill()
  process.exit(0)
}

main().catch(e => { console.error(e); server?.kill(); process.exit(1) })
