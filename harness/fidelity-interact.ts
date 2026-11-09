// Browser scenarios for file safety and the clipboard, run in WebKit against
// the dev server with the Tauri mock. Used by fidelity-gate.ts; standalone:
//   bun harness/fidelity-interact.ts
import type { Page } from '/Users/eoghancollins/.claude/tools/playwright/node_modules/playwright'
import { launchQuill, stopDevServer, type Quill } from './gap-driver'

export interface Result { pass: number; fail: number; failures: string[] }

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const SHELL = 'cargo build \\\n  --release --flag "quoted" \\\n  --out "$VAR/bin"\n\techo \'done\' -- x'

async function md(q: Quill): Promise<string> {
  return q.page.evaluate(() => (window as any).quillDebug.getMarkdown())
}

function paste(page: Page, data: { html?: string; text?: string; types?: Record<string, string> }) {
  return page.evaluate(async (d: any) => {
    const el = document.querySelector('.tiptap') as HTMLElement
    el.focus()
    const dt = new DataTransfer()
    if (d.html) dt.setData('text/html', d.html)
    if (d.text) dt.setData('text/plain', d.text)
    for (const [k, v] of Object.entries(d.types ?? {})) dt.setData(k, v as string)
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
    el.dispatchEvent(ev)
    await new Promise(r => setTimeout(r, 200))
    return ev.defaultPrevented
  }, data)
}

function copyOut(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector('.tiptap') as HTMLElement
    const dt = new DataTransfer()
    const ev = new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true })
    el.dispatchEvent(ev)
    return { text: dt.getData('text/plain'), html: dt.getData('text/html') }
  })
}

/** Select [from, to) in document positions found by a predicate over nodes. */
function selectWhere(page: Page, what: 'codeBlockText' | 'inlineCode' | 'all') {
  return page.evaluate((w: string) => {
    const editor = (window as any).quillDebug.editor
    const { state } = editor
    let from = 0, to = 0
    state.doc.descendants((node: any, pos: number) => {
      if (from) return false
      if (w === 'codeBlockText' && node.type.name === 'codeBlock') { from = pos + 1; to = pos + 1 + node.content.size }
      if (w === 'inlineCode' && node.isText && node.marks.some((m: any) => m.type.name === 'code')) { from = pos; to = pos + node.nodeSize }
      return true
    })
    if (w === 'all') editor.commands.selectAll()
    else editor.commands.setTextSelection({ from, to })
    editor.view.focus()
    return [from, to]
  }, what)
}

export async function runInteract(log: (s: string) => void = console.log): Promise<Result> {
  const r: Result = { pass: 0, fail: 0, failures: [] }
  const check = (name: string, ok: boolean, detail = '') => {
    if (ok) { r.pass++; log(`  ok   ${name}`) } else { r.fail++; r.failures.push(`${name}${detail ? ': ' + detail : ''}`); log(`  FAIL ${name}${detail ? ': ' + detail : ''}`) }
  }
  const scenario = async (name: string, fn: () => Promise<void>) => {
    log(`- ${name}`)
    try { await fn() } catch (e) { check(`${name} (threw)`, false, String((e as Error)?.stack ?? e).slice(0, 400)) }
  }

  // ---- file safety ----------------------------------------------------------

  await scenario('C20 undo after opening another file', async () => {
    const q = await launchQuill({ files: { '/m/a.md': 'AAA file\n', '/m/b.md': 'BBB file\n' }, open: '/m/a.md' })
    const { page } = q
    await page.waitForTimeout(400)
    await page.locator('.tiptap p').first().click()
    await page.keyboard.press('End')
    await page.keyboard.type(' edited')
    await page.keyboard.press('Meta+s')
    await page.waitForTimeout(300)
    await q.setDialog({ open: '/m/b.md' })
    await page.keyboard.press('Meta+o')
    await page.waitForTimeout(500)
    check('B is loaded', (await md(q)) === 'BBB file\n', JSON.stringify(await md(q)))
    await page.locator('.tiptap').click()
    await page.keyboard.press('Meta+z')
    await page.keyboard.press('Meta+z')
    await page.waitForTimeout(200)
    check('undo does not bring back A', (await md(q)) === 'BBB file\n', JSON.stringify(await md(q)))
    await page.keyboard.press('Meta+s')
    await page.waitForTimeout(300)
    check('B on disk unchanged', (await q.readFile('/m/b.md')) === 'BBB file\n', JSON.stringify(await q.readFile('/m/b.md')))
    await q.close()
  })

  await scenario('C26 external change, clean buffer reloads', async () => {
    const q = await launchQuill({ files: { '/m/a.md': 'first version\n' }, open: '/m/a.md' })
    await q.page.waitForTimeout(400)
    await q.writeFile('/m/a.md', 'second version from an agent\n')
    await q.page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await q.page.waitForTimeout(400)
    check('editor shows the new version', (await md(q)) === 'second version from an agent\n', JSON.stringify(await md(q)))
    await q.close()
  })

  await scenario('C26 external change, dirty buffer is never silently overwritten', async () => {
    const q = await launchQuill({ files: { '/m/a.md': 'first version\n' }, open: '/m/a.md', dialog: { ask: false } })
    const { page } = q
    await page.waitForTimeout(400)
    await page.locator('.tiptap p').first().click()
    await page.keyboard.press('End')
    await page.keyboard.type(' mine')
    await q.writeFile('/m/a.md', 'agent rewrote this\n')
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.waitForTimeout(400)
    check('edits kept on focus', (await md(q)) === 'first version mine\n', JSON.stringify(await md(q)))
    check('toast offers reload', (await page.locator('.toast:has-text("changed on disk")').count()) > 0)
    await page.keyboard.press('Meta+s')
    await page.waitForTimeout(400)
    check('cancelled save leaves the agent version on disk', (await q.readFile('/m/a.md')) === 'agent rewrote this\n', JSON.stringify(await q.readFile('/m/a.md')))
    const asked = (await q.calls()).some(c => c.cmd === 'plugin:dialog|ask')
    check('save asked before overwriting', asked)
    await q.setDialog({ ask: true })
    await page.keyboard.press('Meta+s')
    await page.waitForTimeout(400)
    check('confirmed save overwrites', (await q.readFile('/m/a.md')) === 'first version mine\n', JSON.stringify(await q.readFile('/m/a.md')))
    await q.close()
  })

  await scenario('B4 CRLF preserved on save', async () => {
    // (A UTF-8 BOM is stripped by readTextFile's TextDecoder before Quill sees it.)
    const raw = '# Title\r\n\r\nline one\r\nline two\r\n\r\n- a\r\n- b\r\n'
    const q = await launchQuill({ files: { '/m/w.md': raw }, open: '/m/w.md' })
    const { page } = q
    await page.waitForTimeout(400)
    await page.keyboard.press('Meta+s')
    await page.waitForTimeout(300)
    check('unedited save is byte-identical', (await q.readFile('/m/w.md')) === raw, JSON.stringify(await q.readFile('/m/w.md')))
    await page.locator('.tiptap h1').click()
    await page.keyboard.press('End')
    await page.keyboard.type('!')
    await page.keyboard.press('Meta+s')
    await page.waitForTimeout(300)
    check('edited save keeps CRLF', (await q.readFile('/m/w.md')) === raw.replace('# Title', '# Title!'), JSON.stringify(await q.readFile('/m/w.md')))
    await q.close()
  })

  await scenario('edit one list item keeps the rest of the file as written', async () => {
    const src = '* first item with [brackets] and snake_case\n* second item\n  wrapped line\n\nPara with *em* and __strong__.\n'
    const q = await launchQuill({ files: { '/m/l.md': src }, open: '/m/l.md' })
    const { page } = q
    await page.waitForTimeout(400)
    await page.locator('.tiptap li').nth(1).locator('p').click()
    await page.keyboard.press('End')
    await page.keyboard.type(' more')
    const out = await md(q)
    check('only the edited line changes', out === '* first item with [brackets] and snake_case\n* second item\n  wrapped line more\n\nPara with *em* and __strong__.\n', JSON.stringify(out))
    await q.close()
  })

  // ---- typing ---------------------------------------------------------------

  await scenario('B7 no smart typography', async () => {
    const q = await launchQuill({ files: { '/m/a.md': '' }, open: '/m/a.md' })
    await q.page.waitForTimeout(300)
    await q.page.locator('.tiptap').click()
    await q.page.keyboard.type('run x -> y -- z "q" \'s\' ... (c) 1/2 --flag')
    const out = await md(q)
    check('ASCII kept', out === 'run x -> y -- z "q" \'s\' ... (c) 1/2 --flag\n', JSON.stringify(out))
    await q.close()
  })

  await scenario('C11 Enter in a table cell', async () => {
    const q = await launchQuill({ files: { '/m/a.md': '| a | b |\n|---|---|\n| 1 | 2 |\n' }, open: '/m/a.md' })
    await q.page.waitForTimeout(300)
    await q.page.locator('.tiptap td').first().click()
    await q.page.keyboard.press('End')
    await q.page.keyboard.press('Enter')
    await q.page.keyboard.type('second')
    const out = await md(q)
    check('saved with <br>', /\| 1<br>second +\| 2 +\|/.test(out), JSON.stringify(out))
    await q.close()
  })

  // ---- copy out -------------------------------------------------------------

  await scenario('copy: code block selection is raw code', async () => {
    const doc = 'Intro\n\n```bash\n' + SHELL + '\n```\n\nUse `ls -la "$HOME"` here.\n'
    const q = await launchQuill({ files: { '/m/a.md': doc }, open: '/m/a.md' })
    const { page } = q
    await page.waitForTimeout(400)
    await selectWhere(page, 'codeBlockText')
    let c = await copyOut(page)
    check('code block text/plain is raw', c.text === SHELL, JSON.stringify(c.text))
    await selectWhere(page, 'inlineCode')
    c = await copyOut(page)
    check('inline code text/plain is raw', c.text === 'ls -la "$HOME"', JSON.stringify(c.text))
    await selectWhere(page, 'all')
    c = await copyOut(page)
    check('mixed selection copies markdown', c.text === doc.replace(/\n$/, ''), JSON.stringify(c.text))
    await q.close()
  })

  await scenario('copy button works when navigator.clipboard rejects', async () => {
    const q = await launchQuill({ files: { '/m/a.md': '```bash\n' + SHELL + '\n```\n' }, open: '/m/a.md' })
    const { page } = q
    await page.waitForTimeout(400)
    await page.evaluate(() => {
      const w = window as any
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error('NotAllowedError')) },
      })
      w.__copied = null
      document.addEventListener('copy', (e: ClipboardEvent) => {
        // Runs after the helper's own listener has set the data.
        setTimeout(() => {}, 0)
        w.__copiedEvent = true
      }, true)
      const orig = document.execCommand.bind(document)
      document.execCommand = (cmd: string, ...rest: any[]) => {
        if (cmd === 'copy') {
          const ta = document.activeElement as HTMLTextAreaElement
          w.__copied = ta?.value ?? null
        }
        return orig(cmd, ...rest)
      }
    })
    await page.locator('.code-block-copy').click()
    await page.waitForTimeout(200)
    const copied = await page.evaluate(() => (window as any).__copied)
    const state = await page.locator('.code-block-copy').getAttribute('data-copy-state')
    check('fallback copied the raw code', copied === SHELL, JSON.stringify(copied))
    check('button shows success', state === 'copied', String(state))
    await q.close()
  })

  await scenario('copy: rich HTML for other apps', async () => {
    const doc = 'Energy $E=mc^2$ and ![p](assets/p.png)\n\n```mermaid\ngraph TD\n  A-->B\n```\n'
    const q = await launchQuill({ files: { '/m/doc/a.md': doc }, open: '/m/doc/a.md' })
    const { page } = q
    await page.waitForTimeout(2500) // mermaid renders
    await selectWhere(page, 'all')
    const c = await copyOut(page)
    check('text/plain is markdown', c.text === doc.replace(/\n$/, ''), JSON.stringify(c.text))
    check('math as LaTeX source in html', c.html.includes('$E=mc^2$'), c.html.slice(0, 300))
    check('mermaid as svg image or code', /data-code="graph TD/.test(c.html) && /(data:image\/svg\+xml|language-mermaid)/.test(c.html), c.html.slice(0, 400))
    check('local image absolutised', c.html.includes('src="file:///m/doc/assets/p.png"'), (c.html.match(/<img[^>]*>/) ?? [''])[0])
    await q.close()
  })

  // ---- paste in -------------------------------------------------------------

  await scenario('paste', async () => {
    const q = await launchQuill({ files: { '/m/a.md': '' }, open: '/m/a.md' })
    const { page } = q
    await page.waitForTimeout(300)
    const reset = () => page.evaluate(() => (window as any).quillDebug.setMarkdown(''))
    const nodes = () => page.evaluate(() => (window as any).quillDebug.editor.getJSON().content.map((n: any) => n.type))

    await reset()
    await paste(page, {
      text: '# Title\n\nSome **bold** text\n\n- item one\n- item two\n',
      html: '<meta charset="utf-8"><div style="color: #d4d4d4;background-color: #1e1e1e;font-family: Menlo, Monaco, monospace;white-space: pre;"><div><span style="color: #569cd6;"># Title</span></div><br><div><span>Some **bold** text</span></div></div>',
      types: { 'vscode-editor-data': '{"version":1,"mode":"markdown"}' },
    })
    check('VS Code paste parses markdown', (await md(q)) === '# Title\n\nSome **bold** text\n\n- item one\n- item two\n', JSON.stringify(await md(q)))

    await reset()
    await paste(page, { text: 'Use `foo()` and *emphasis* here' })
    const j = await page.evaluate(() => JSON.stringify((window as any).quillDebug.editor.getJSON()))
    check('inline-only markdown becomes marks', j.includes('"code"') && j.includes('"italic"') && (await nodes()).filter((t: string) => t === 'paragraph').length <= 2, j.slice(0, 300))

    await reset()
    await paste(page, { text: 'Name\tQty\tPrice\nApple\t3\t1.20\nPear\t5\t0.80\n' })
    check('TSV becomes a table with header', (await md(q)).startsWith('| Name  | Qty | Price |\n| ----- | --- | ----- |\n| Apple | 3   | 1.20  |'), JSON.stringify(await md(q)))

    await reset()
    await paste(page, { text: 'name,qty\napple,3\npear,5\n' })
    check('CSV becomes a table', (await md(q)).startsWith('| name'), JSON.stringify(await md(q)))

    await reset()
    await paste(page, {
      html: '<table><tbody><tr><td>Name</td><td>Qty</td></tr><tr><td>Apple</td><td>3</td></tr></tbody></table>',
      text: 'Name\tQty\nApple\t3\n',
    })
    const xl = await md(q)
    check('Excel/Sheets table keeps first row as header', /^\| Name +\| Qty +\|\n\| -+ \| -+ \|\n\| Apple/.test(xl), JSON.stringify(xl))

    await reset()
    await paste(page, {
      html: '<pre><div class="flex items-center">bash<button>Copy code</button></div><div><code class="whitespace-pre! language-bash">npm i quill\n</code></div></pre>',
      text: 'bash\nCopy code\nnpm i quill\n',
    })
    const cg = await md(q)
    check('chat code block loses its label', cg === '```bash\nnpm i quill\n```\n', JSON.stringify(cg))

    await reset()
    await paste(page, {
      html: '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr"><span style="text-decoration:underline;">under</span><span> and </span><span style="font-family:\'Courier New\',monospace;">mono</span></p></b>',
      text: 'under and mono',
    })
    const gd = await md(q)
    check('Google Docs underline and monospace', gd === '<u>under</u> and `mono`\n', JSON.stringify(gd))

    await reset()
    await paste(page, { text: 'Replace <API_KEY> in the file' })
    check('plain text with angle brackets stays literal', (await md(q)) === 'Replace <API_KEY> in the file\n', JSON.stringify(await md(q)))
    void PNG
    await q.close()
  })

  return r
}

if (import.meta.main) {
  const res = await runInteract()
  console.log(`\ninteract: ${res.pass} passed, ${res.fail} failed`)
  stopDevServer()
  process.exit(res.fail ? 1 : 0)
}
