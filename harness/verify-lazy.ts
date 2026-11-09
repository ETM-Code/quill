// Production-build check for lazy KaTeX / Mermaid: which chunks load for which documents, and that
// math renders (placeholder with LaTeX source first, then typeset) and prints typeset.
// Usage: bun harness/verify-lazy.ts [--dist=<dir>] [--port=1438]
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, existsSync } from 'node:fs'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHARED = '/Users/eoghancollins/.claude/tools/playwright/node_modules/playwright/index.mjs'
const { webkit } = await import(existsSync(SHARED) ? SHARED : 'playwright')
const arg = (k: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1]
const PORT = Number(arg('port') ?? 1438), BASE = `http://localhost:${PORT}`
const MOCK = readFileSync(join(ROOT, 'harness', 'tauri-mock.js'), 'utf8')
const server = spawn('node', [join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort', ...(arg('dist') ? ['--outDir', arg('dist')!] : [])], { cwd: ROOT, stdio: 'ignore' })
process.on('exit', () => server.kill())
for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE, { signal: AbortSignal.timeout(500) })).ok) break } catch {} await new Promise(r => setTimeout(r, 250)) }
const browser = await webkit.launch()
let bad = 0
const check = (name: string, ok: boolean, extra?: unknown) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '  ' + JSON.stringify(extra)}`) }
async function open(md: string) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } })
  await ctx.addInitScript(`window.__QUILL_MOCK_SEED__ = ${JSON.stringify({ files: { '/m/a.md': md }, dialog: {} })};\n${MOCK}`)
  const reqs: string[] = [], errors: string[] = []
  const page = await ctx.newPage()
  page.on('request', r => reqs.push(new URL(r.url()).pathname))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto(`${BASE}/?open=${encodeURIComponent('/m/a.md')}`)
  await page.waitForFunction(() => (window as any).quillDebug?.editor, undefined, { timeout: 60000 })
  await page.waitForTimeout(800)
  return { ctx, page, reqs, errors }
}
const has = (reqs: string[], s: string) => reqs.some(r => r.includes(s))

const plain = await open('# Hello\n\nJust text and `code`.\n\n```js\nconst a = 1\n```\n')
check('no-math doc: katex JS not fetched', !has(plain.reqs, 'katex-'), plain.reqs.filter(r => r.includes('katex')))
check('no-math doc: katex css/fonts not fetched', !plain.reqs.some(r => /KaTeX_|katex.*\.css/.test(r)))
check('no-math doc: mermaid not fetched', !plain.reqs.some(r => /mermaid|cytoscape|architecture/i.test(r)), plain.reqs.filter(r => /mermaid/i.test(r)))
check('code block select has a single option until used', await plain.page.evaluate(() => document.querySelector('.code-block-lang')!.querySelectorAll('option').length) === 1)
await plain.page.focus('.code-block-lang')
check('options fill on focus', await plain.page.evaluate(() => document.querySelector('.code-block-lang')!.querySelectorAll('option').length) > 30)
check('selected language preserved after fill', (await plain.page.inputValue('.code-block-lang')) === 'javascript')
check('no-math doc: no console errors', plain.errors.length === 0, plain.errors)
await plain.ctx.close()

const math = await open('# Math\n\nInline $E=mc^2$ here.\n\n$$\\int_0^1 x\\,dx = \\tfrac12$$\n')
check('math doc: katex chunk fetched', has(math.reqs, 'katex-'))
check('math doc: katex css fetched', math.reqs.some(r => /katex.*\.css/.test(r)))
check('math doc: only woff2 fonts requested', math.reqs.filter(r => /KaTeX_/.test(r)).every(r => r.endsWith('.woff2')), math.reqs.filter(r => /KaTeX_/.test(r)))
const st = await math.page.evaluate(() => ({ katex: document.querySelectorAll('.tiptap .katex').length, display: document.querySelectorAll('.tiptap .katex-display').length, inline: document.querySelector('[data-type="inline-math"]')?.getAttribute('data-latex'), mathml: document.querySelectorAll('.tiptap .katex-mathml').length }))
check('math doc: inline + block typeset', st.katex >= 2 && st.display >= 1 && st.inline === 'E=mc^2', st)
check('math doc: mermaid still not fetched', !math.reqs.some(r => /mermaid/i.test(r)))
await math.page.screenshot({ path: join(ROOT, 'harness', 'shots', 'verify-lazy-math.png') })
// Copy-out HTML keeps the LaTeX source
const html = await math.page.evaluate(async () => {
  const e = (window as any).quillDebug.editor
  e.commands.selectAll()
  const dt = new DataTransfer()
  const ev = new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true })
  e.view.dom.dispatchEvent(ev)
  return { html: dt.getData('text/html'), text: dt.getData('text/plain') }
})
check('copy-out html carries LaTeX source', html.html.includes('data-latex="E=mc^2"') && html.text.includes('$E=mc^2$'), { html: html.html.slice(0, 200), text: html.text })
check('math doc: no console errors', math.errors.length === 0, math.errors)
await math.ctx.close()

// Edit math in a doc opened before KaTeX arrived: the popover preview + node update still typeset.
const mixed = await open('Plain $x^2$ line.\n')
await mixed.page.click('[data-type="inline-math"]')
await mixed.page.waitForTimeout(400)
check('popover preview typeset', await mixed.page.evaluate(() => !!document.querySelector('.math-popover-preview .katex')))
await mixed.page.fill('.math-popover-input', 'y^3')
await mixed.page.press('.math-popover-input', 'Enter')
await mixed.page.waitForTimeout(300)
check('edited math re-rendered', await mixed.page.evaluate(() => document.querySelector('[data-type="inline-math"]')!.getAttribute('data-latex') === 'y^3' && !!document.querySelector('[data-type="inline-math"] .katex')))
await mixed.ctx.close()

const mer = await open('# D\n\n```mermaid\ngraph TD\n  A-->B\n```\n')
check('mermaid doc: mermaid fetched', mer.reqs.some(r => /mermaid/i.test(r)))
check('mermaid doc: diagram rendered', await mer.page.evaluate(() => !!document.querySelector('.tiptap svg')))
await mer.ctx.close()
await browser.close(); server.kill()
process.exit(bad ? 1 : 0)
