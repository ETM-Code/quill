// Interaction gap audit. Run: bun harness/gap-interact.ts [section]
// Output: .agent-logs/interact.txt
import { launchQuill, stopDevServer } from './gap-driver'
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'

const OUT = join(import.meta.dir, '..', '.agent-logs')
const SHOTS = join(OUT, 'shots')
mkdirSync(SHOTS, { recursive: true })
const LOG = join(OUT, 'interact.txt')
writeFileSync(LOG, '')
const log = (s: string) => { console.log(s); appendFileSync(LOG, s + '\n') }
const only = process.argv[2]

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function fresh(md = '', extra: Record<string, string> = {}) {
  const q = await launchQuill({ files: { '/mock/doc/a.md': md, '/mock/doc/other.md': '# other', ...extra }, open: '/mock/doc/a.md' })
  await q.page.waitForTimeout(500)
  return q
}

const paste = (page: any, data: { html?: string; text?: string; file?: boolean }) => page.evaluate(async (d: any) => {
  const el = document.querySelector('.tiptap') as HTMLElement
  el.focus()
  const dt = new DataTransfer()
  if (d.html) dt.setData('text/html', d.html)
  if (d.text) dt.setData('text/plain', d.text)
  if (d.file) {
    const bin = atob(d.png); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
    dt.items.add(new File([u8], 'x.png', { type: 'image/png' }))
  }
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
  el.dispatchEvent(ev)
  await new Promise(r => setTimeout(r, 300))
  return { defaultPrevented: ev.defaultPrevented }
}, { ...data, png: PNG })

const copyOut = (page: any) => page.evaluate(() => {
  const el = document.querySelector('.tiptap') as HTMLElement
  el.focus()
  const dt = new DataTransfer()
  const ev = new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true })
  el.dispatchEvent(ev)
  return { text: dt.getData('text/plain'), html: dt.getData('text/html'), types: [...dt.types] }
})

const md = (page: any): Promise<string> => page.evaluate(() => (window as any).quillDebug.getMarkdown())
const setMd = (page: any, m: string) => page.evaluate((m: string) => (window as any).quillDebug.setMarkdown(m), m)
const ed = <T>(page: any, fn: (editor: any) => T, arg?: any): Promise<T> =>
  page.evaluate(([f, a]: any) => (new Function('editor', 'arg', 'return (' + f + ')(editor, arg)'))((window as any).quillDebug.editor, a), [fn.toString(), arg])

async function section(name: string, fn: () => Promise<void>) {
  if (only && only !== name) return
  log(`\n######## ${name}`)
  try { await fn() } catch (e: any) { log(`!! section ${name} threw: ${e?.message ?? e}`) }
}

async function main() {
  await section('links', async () => {
    const q = await fresh('See [site](https://example.com "T") and [rel](./other.md) and [anc](#heading-two) and [mail](mailto:a@b.com) and bare https://bare.example.com/x.\n\n## Heading Two\n\ntext\n')
    const { page } = q
    for (const [label, sel] of [['site', 'a[href="https://example.com"]'], ['rel', 'a[href="./other.md"]'], ['anchor', 'a[href="#heading-two"]'], ['mail', 'a[href^="mailto"]'], ['bare', 'a[href^="https://bare"]']] as const) {
      await page.locator('.tiptap ' + sel).first().click()
      await page.waitForTimeout(200)
      const pop = await page.evaluate(() => { const p = document.querySelector('.link-popover') as HTMLElement | null; return p && getComputedStyle(p).display !== 'none' && p.offsetWidth > 0 ? (p.querySelector('.link-popover-url') as HTMLElement)?.textContent : null })
      log(`plain click ${label}: popover=${pop ? JSON.stringify(pop) : 'none'} openedUrls=${JSON.stringify(await q.openedUrls())}`)
      await page.keyboard.press('Escape')
      await page.locator('.tiptap ' + sel).first().click({ modifiers: ['Meta'] })
      await page.waitForTimeout(200)
      log(`cmd+click ${label}: openedUrls=${JSON.stringify(await q.openedUrls())}`)
    }
    log('link attrs: ' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.tiptap a')].map(a => ({ href: a.getAttribute('href'), title: a.getAttribute('title'), target: a.getAttribute('target') })))))
    log('heading ids: ' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.tiptap h1,.tiptap h2')].map(h => h.id))))
    log('link cursor/title css: ' + JSON.stringify(await page.evaluate(() => { const a = document.querySelector('.tiptap a')!; return { cursor: getComputedStyle(a).cursor, title: a.getAttribute('title') } })))
    // plain click then escape -> does clicking away close popover; and typing inside link
    log('console errors: ' + JSON.stringify(q.consoleErrors))
    await q.close()
  })

  await section('images', async () => {
    const q = await fresh('Before ![alt text](https://example.com/a.png "Title") after\n\n![local](assets/x.png)\n')
    const { page } = q
    await page.locator('.tiptap img').first().click()
    await page.waitForTimeout(300)
    log('after click image: selection=' + JSON.stringify(await ed(page, (e: any) => ({ type: e.state.selection.constructor.name, nodeType: e.state.selection.node?.type?.name }))))
    log('popover/bubble visible after image click: ' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.bubble-menu,.link-popover,.popover')].map(p => [p.className, (p as HTMLElement).style.display, (p as HTMLElement).offsetWidth]))))
    await page.locator('.tiptap img').first().dblclick()
    await page.waitForTimeout(300)
    log('after dblclick image: openedUrls=' + JSON.stringify(await q.openedUrls()) + ' popovers=' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.bubble-menu,.link-popover,.popover')].filter(p => (p as HTMLElement).offsetWidth > 0).map(p => p.className))))
    await page.locator('.tiptap img').first().click({ modifiers: ['Meta'] })
    await page.waitForTimeout(200)
    log('cmd+click image: openedUrls=' + JSON.stringify(await q.openedUrls()))
    log('img attrs: ' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.tiptap img')].map(i => ({ src: i.getAttribute('src'), alt: i.getAttribute('alt'), title: i.getAttribute('title'), draggable: i.getAttribute('draggable'), resize: getComputedStyle(i).resize, cursor: getComputedStyle(i).cursor })))))
    // image paste in unsaved doc
    const q2 = await launchQuill({})
    await q2.page.waitForTimeout(500)
    const r = await paste(q2.page, { file: true })
    await q2.page.waitForTimeout(500)
    log('paste image into UNSAVED doc: ' + JSON.stringify(r) + ' md=' + JSON.stringify(await md(q2.page)) + ' toast=' + JSON.stringify(await q2.page.evaluate(() => document.querySelector('.toast')?.textContent ?? null)))
    await q2.close()
    // paste image into saved doc
    const r2 = await paste(page, { file: true })
    await page.waitForTimeout(500)
    log('paste image into saved doc: ' + JSON.stringify(r2) + ' writes=' + JSON.stringify((await q.calls()).filter(c => c.cmd === 'write_image_file').map(c => (c.args as any).path)) + ' md tail=' + JSON.stringify((await md(page)).slice(-80)))
    // dropped image via DOM drop event (works in browser harness; real Tauri intercepts)
    const dropRes = await page.evaluate(() => {
      const el = document.querySelector('.tiptap') as HTMLElement
      const bin = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
      const dt = new DataTransfer(); dt.items.add(new File([u8], 'd.png', { type: 'image/png' }))
      const ev = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: 300, clientY: 200 })
      el.dispatchEvent(ev); return ev.defaultPrevented
    })
    await page.waitForTimeout(400)
    log('DOM drop of image file (browser-level): handled=' + dropRes + ' md tail=' + JSON.stringify((await md(page)).slice(-80)))
    await q.close()
  })

  await section('tables', async () => {
    const q = await fresh('Intro\n\n| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\nAfter\n')
    const { page } = q
    await page.locator('.tiptap td').first().click()
    await page.waitForTimeout(300)
    const bar = () => page.evaluate(() => { const b = document.querySelector('.bubble-menu') as HTMLElement; return b && b.offsetWidth > 0 ? [...b.querySelectorAll('button')].filter(x => (x as HTMLElement).offsetWidth > 0).map(x => x.title) : null })
    log('toolbar when caret in table: ' + JSON.stringify(await bar()))
    await page.screenshot({ path: join(SHOTS, 'table-caret.png') })
    // Tab nav
    await page.keyboard.press('Tab'); await page.keyboard.type('X')
    await page.keyboard.press('Tab'); await page.keyboard.type('Y')
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.type('Z')
    log('after Tab x4 typing X,Y,Z:\n' + await md(page))
    await page.keyboard.press('Tab')
    log('Tab in last cell adds row? rows=' + await page.locator('.tiptap tr').count())
    await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Shift+Tab'); await page.keyboard.type('S')
    // Enter in cell
    await page.locator('.tiptap td').first().click()
    await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.keyboard.type('second-line')
    log('Enter in cell:\n' + await md(page))
    log('cell paragraphs in first td: ' + await page.locator('.tiptap td').first().locator('p').count())
    // Shift+Enter
    await page.keyboard.press('Shift+Enter'); await page.keyboard.type('brk')
    log('Shift+Enter in cell:\n' + await md(page))
    // Select-all within cell, Backspace on empty table, arrow down out of last row
    await page.locator('.tiptap tr').last().locator('td').last().click()
    await page.keyboard.press('ArrowDown'); await page.keyboard.type('OUT')
    log('ArrowDown from last row lands in: ' + JSON.stringify(await ed(page, (e: any) => e.state.selection.$from.parent.type.name + ':' + e.state.selection.$from.parent.textContent)))
    // header toggle, delete table via button
    const btn = (title: string) => page.locator(`.bubble-menu button[title="${title}"]`)
    await page.locator('.tiptap td').first().click(); await page.waitForTimeout(200)
    await btn('Add column right').click(); await btn('Add row below (or Tab in the last cell)').click(); await btn('Toggle header row').click()
    log('after add col/row, toggle header:\n' + await md(page))
    await btn('Delete table').click()
    log('after Delete table: tables=' + await page.locator('.tiptap table').count() + ' md=' + JSON.stringify(await md(page)))
    // undo
    await page.keyboard.press('Meta+z'); await page.waitForTimeout(200)
    log('undo after delete table: tables=' + await page.locator('.tiptap table').count())
    // Alignment capability
    log('table node attrs/commands: ' + JSON.stringify(await ed(page, (e: any) => ({ hasSetCellAttribute: typeof e.commands.setCellAttribute, hasMerge: typeof e.commands.mergeCells, hasGoToNextCell: typeof e.commands.goToNextCell, alignAttrCell: Object.keys(e.schema.nodes.tableCell.spec.attrs ?? {}) }))))
    // Fresh table from slash menu
    await page.locator('.tiptap p').last().click(); await page.keyboard.press('Enter'); await page.keyboard.type('/table'); await page.waitForTimeout(300); await page.keyboard.press('Enter'); await page.waitForTimeout(300)
    log('slash /table inserted: tables=' + await page.locator('.tiptap table').count())
    // Markdown shorthand typed table
    await q.close()

    // Paste cases
    const q2 = await fresh('')
    const p2 = q2.page
    const tsv = 'Name\tQty\tPrice\nApple\t3\t1.20\nPear\t5\t0.80'
    await paste(p2, { text: tsv })
    log('paste TSV (text only): tables=' + await p2.locator('.tiptap table').count() + ' md=' + JSON.stringify(await md(p2)))
    await setMd(p2, '')
    const excelHtml = '<html><body><!--StartFragment--><table border=0 cellpadding=0 cellspacing=0><tr><td>Name</td><td>Qty</td></tr><tr><td>Apple</td><td>3</td></tr></table><!--EndFragment--></body></html>'
    await paste(p2, { html: excelHtml, text: 'Name\tQty\nApple\t3' })
    log('paste Excel/HTML table: tables=' + await p2.locator('.tiptap table').count() + ' md=' + JSON.stringify(await md(p2)))
    await setMd(p2, '')
    const sheetsHtml = '<meta charset="utf-8"><google-sheets-html-origin><style type="text/css"><!--td {border: 1px solid #cccccc;}--></style><table xmlns="http://www.w3.org/1999/xhtml" cellspacing="0" cellpadding="0" dir="ltr" border="1" style="table-layout:fixed;font-size:10pt;"><colgroup><col width="100"/><col width="100"/></colgroup><tbody><tr style="height:21px;"><td style="overflow:hidden;" data-sheets-value="{&quot;1&quot;:2,&quot;2&quot;:&quot;A&quot;}">A</td><td>B</td></tr><tr><td>1</td><td>2</td></tr></tbody></table>'
    await paste(p2, { html: sheetsHtml, text: 'A\tB\n1\t2' })
    log('paste Google-Sheets HTML table: tables=' + await p2.locator('.tiptap table').count() + ' md=' + JSON.stringify(await md(p2)))
    await setMd(p2, '')
    await paste(p2, { text: '| a | b |\n|---|---|\n| 1 | 2 |' })
    log('paste markdown table text: tables=' + await p2.locator('.tiptap table').count())
    // Copy out a table
    await p2.locator('.tiptap td').first().click()
    await p2.keyboard.press('Meta+a')
    const c = await copyOut(p2)
    log('copy-out whole doc w/ table: text=' + JSON.stringify(c.text) + ' html=' + JSON.stringify(c.html.slice(0, 600)))
    await q2.close()
  })

  await section('copyout', async () => {
    const q = await fresh('# Title\n\nSome **bold** and *italic* and `code` and [link](https://x.com) text.\n\n- one\n- two\n\n```js\nconst a = 1\n```\n\nMath $E=mc^2$ and ![img](assets/p.png)\n\n$$\nx^2\n$$\n\n```mermaid\ngraph TD\n A-->B\n```\n')
    const { page } = q
    await page.locator('.tiptap').click()
    await page.keyboard.press('Meta+a')
    const c = await copyOut(page)
    log('types: ' + JSON.stringify(c.types))
    log('text/plain:\n' + c.text)
    log('text/html:\n' + c.html)
    // partial selection in a plain paragraph
    await setMd(page, 'Hello wonderful world, this is plain.\n')
    await page.locator('.tiptap p').first().click()
    await page.keyboard.press('Home'); await page.keyboard.press('Shift+ArrowRight'); await page.keyboard.press('Shift+ArrowRight'); await page.keyboard.press('Shift+ArrowRight'); await page.keyboard.press('Shift+ArrowRight'); await page.keyboard.press('Shift+ArrowRight')
    const c2 = await copyOut(page)
    log('partial plain selection "Hello": text=' + JSON.stringify(c2.text) + ' html=' + JSON.stringify(c2.html))
    await setMd(page, 'a **bold word** here\n')
    await page.locator('.tiptap strong').first().dblclick()
    const c3 = await copyOut(page)
    log('selected bold word: text=' + JSON.stringify(c3.text) + ' html=' + JSON.stringify(c3.html))
    await setMd(page, '# Heading text\n\nbody\n')
    await page.locator('.tiptap h1').dblclick()
    const c4 = await copyOut(page)
    log('double-click word in heading: text=' + JSON.stringify(c4.text) + ' html=' + JSON.stringify(c4.html))
    // inside code block
    await setMd(page, '```js\nconst a = 1\nconst b = 2\n```\n')
    await page.locator('.tiptap code').click(); await page.keyboard.press('Meta+a')
    const c5 = await copyOut(page)
    log('Cmd+A inside code block copy: text=' + JSON.stringify(c5.text))
    await q.close()
  })

  await section('paste', async () => {
    const q = await fresh('')
    const { page } = q
    const cases: Array<[string, { html?: string; text?: string }]> = [
      ['web page html', { html: '<meta charset="utf-8"><h2>Title</h2><p>Para with <a href="https://x.com">link</a> and <strong>bold</strong>.</p><ul><li>one</li><li>two</li></ul><pre><code>x = 1\ny = 2</code></pre>', text: 'Title\nPara with link and bold.\none\ntwo\nx = 1\ny = 2' }],
      ['google docs html', { html: '<meta charset=\'utf-8\'><meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1234"><h1 dir="ltr" style="line-height:1.38;"><span style="font-size:20pt;font-weight:400;">Doc title</span></h1><p dir="ltr"><span style="font-size:11pt;font-weight:700;">Bold</span><span style="font-size:11pt;font-style:italic;"> ital</span><span style="font-size:11pt;text-decoration:underline;"> und</span><span style="font-size:11pt;text-decoration:line-through;"> strike</span></p><ul><li dir="ltr"><p dir="ltr"><span>bullet</span></p></li></ul></b>', text: 'Doc title\nBold ital und strike\nbullet' }],
      ['vscode markdown (html+text)', { html: '<meta charset=\'utf-8\'><div style="color:#ccc;background-color:#1f1f1f;font-family:Menlo;font-weight:normal;font-size:12px;line-height:18px;white-space:pre;"><div><span style="color:#569cd6;"># Title</span></div><div><span style="color:#ccc;">Some **bold** text</span></div><div><span>- item one</span></div><div><span>- item two</span></div></div>', text: '# Title\nSome **bold** text\n- item one\n- item two' }],
      ['plain markdown text (no html)', { text: '# Title\n\nSome **bold** text\n\n- item one\n- item two\n' }],
      ['plain: inline-only markdown', { text: 'Use `foo()` and *emphasis* and ~~gone~~ here' }],
      ['plain: single list item / numbered', { text: '1. first\n2. second' }],
      ['plain: image + math', { text: '![alt](a.png) and $x^2$' }],
      ['plain: markdown with html tags', { text: 'Hello <b>x</b> and <br> y' }],
      ['plain: bare URL', { text: 'https://example.com/path' }],
      ['plain: multi-line text no md', { text: 'line one\nline two\n\nline three' }],
      ['chatgpt/claude web html', { html: '<div class="markdown"><h3>Heading</h3><p>text <code>inline</code></p><pre class="x"><div>bash</div><code class="language-bash">npm i\nnpm run dev</code></pre><table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table></div>', text: 'Heading\ntext inline\nbash\nnpm i\nnpm run dev\nA\n1' }],
      ['html with inline styles bold (span)', { html: '<p><span style="font-weight:700">B</span> <span style="font-style:italic">I</span> <span style="font-family:monospace">M</span> <mark>H</mark> <sub>2</sub> <sup>3</sup></p>' }],
      ['html with img remote', { html: '<p><img src="https://example.com/p.png" alt="pic"></p>' }],
      ['html mail with div soup', { html: '<div>Hello<br><br>Line 2</div><div>Line 3</div>' }],
    ]
    for (const [name, data] of cases) {
      await setMd(page, '')
      await page.locator('.tiptap').click()
      const r = await paste(page, data)
      const types = await ed(page, (e: any) => e.state.doc.content.content.map((n: any) => n.type.name + (n.type.name === 'heading' ? n.attrs.level : '')).join(','))
      log(`paste [${name}] handled=${r.defaultPrevented} nodes=[${types}] -> ${JSON.stringify(await md(page))}`)
    }
    // URL over selection
    await setMd(page, 'click here now\n')
    await page.locator('.tiptap p').click(); await page.keyboard.press('Meta+ArrowLeft'); await page.keyboard.press('Alt+ArrowRight'); await page.keyboard.press('Shift+Alt+ArrowRight')
    await paste(page, { text: 'https://example.com' })
    log('paste URL over selection -> ' + JSON.stringify(await md(page)))
    // paste into code block (plain with md-like)
    await setMd(page, '```\n\n```\n')
    await ed(page, (e: any) => e.commands.setTextSelection(1)); await ed(page, (e: any) => e.view.focus())
    await paste(page, { text: '# not heading\n- not list' })
    log('paste md-like text into code block -> ' + JSON.stringify(await md(page)))
    // paste html into code block
    await setMd(page, '```\n\n```\n')
    await ed(page, (e: any) => e.commands.setTextSelection(1)); await ed(page, (e: any) => e.view.focus())
    await paste(page, { html: '<div style="font-family:Menlo"><span style="color:red">const</span> a = 1;</div>', text: 'const a = 1;' })
    log('paste VSCode-style html into code block -> ' + JSON.stringify(await md(page)))
    // Paste within a list item
    await setMd(page, '- a\n')
    await page.locator('.tiptap li p').click(); await page.keyboard.press('End')
    await paste(page, { text: '# H\n\npara' })
    log('paste markdown inside list item -> ' + JSON.stringify(await md(page)))
    // Undo after markdown paste
    await setMd(page, 'start\n'); await page.waitForTimeout(700); await page.locator('.tiptap p').click(); await page.keyboard.press('End')
    await paste(page, { text: '\n\n## pasted\n\n- a\n- b' })
    const before = await md(page)
    await page.keyboard.press('Meta+z'); await page.waitForTimeout(200)
    log('undo after md paste: before=' + JSON.stringify(before) + ' after=' + JSON.stringify(await md(page)))
    await q.close()
  })

  await section('undo', async () => {
    const q = await fresh('# Loaded doc\n\ncontent here\n')
    const { page } = q
    await page.locator('.tiptap p').first().click()
    await page.keyboard.press('Meta+z'); await page.waitForTimeout(200)
    log('Cmd+Z immediately after opening a file (no edits): md=' + JSON.stringify(await md(page)))
    await page.keyboard.press('Meta+Shift+z'); await page.waitForTimeout(200)
    log('Redo: md=' + JSON.stringify(await md(page)))
    await q.close()
    const q2 = await fresh('abc\n')
    const p2 = q2.page
    await p2.locator('.tiptap p').click(); await p2.keyboard.press('End'); await p2.keyboard.type(' typed')
    await p2.waitForTimeout(100)
    await p2.keyboard.press('Meta+z'); await p2.waitForTimeout(100)
    log('undo typing: ' + JSON.stringify(await md(p2)))
    await setMd(p2, 'second file contents\n')
    await p2.keyboard.press('Meta+z'); await p2.waitForTimeout(100)
    log('setMarkdown (open another file) then Cmd+Z: ' + JSON.stringify(await md(p2)))
    await q2.close()
  })

  await section('shortcuts', async () => {
    const q = await fresh('para one\n\npara two\n')
    const { page } = q
    const combos: Array<[string, string]> = [
      ['Meta+b', 'bold'], ['Meta+i', 'italic'], ['Meta+u', 'underline'], ['Meta+e', 'code'], ['Meta+Shift+s', 'strike?'], ['Meta+Shift+x', 'strike(alt)'],
      ['Meta+Shift+h', 'highlight'], ['Meta+Shift+7', 'ordered list'], ['Meta+Shift+8', 'bullet list'], ['Meta+Shift+9', 'blockquote'], ['Meta+Shift+l', 'task list?'],
      ['Meta+Alt+1', 'H1'], ['Meta+Alt+2', 'H2'], ['Meta+1', 'H1 (Typora)'], ['Meta+2', 'H2 (Typora)'], ['Meta+0', 'paragraph (Typora)'],
      ['Meta+Alt+c', 'code block'], ['Meta+Shift+c', 'code block (Typora)'], ['Meta+Alt+t', 'table?'], ['Meta+Shift+k', 'code block? ⌘⇧K'], ['Meta+Shift+m', 'math block (Typora)'],
      ['Meta+Shift+u', 'bullets? '], ['Meta+/', 'source toggle'], ['Meta+Shift+i', 'image'], ['Meta+p', 'print'],
    ]
    for (const [combo, label] of combos) {
      await setMd(page, 'para one\n\npara two\n')
      await page.waitForTimeout(150)
      await page.locator('.tiptap p').first().click()
      await ed(page, (e: any) => { e.commands.setTextSelection({ from: 1, to: 9 }); e.view.focus() })
      await page.waitForTimeout(100)
      const callsBefore = (await q.calls()).length
      await page.keyboard.press(combo)
      await page.waitForTimeout(300)
      const m = await md(page)
      const newCalls = (await q.calls()).slice(callsBefore).map(c => c.cmd).filter(c => !c.startsWith('plugin:event'))
      log(`${combo.padEnd(14)} (${label}) -> ${JSON.stringify(m.split('\n')[0])}${newCalls.length ? ' ipc=' + newCalls.join(',') : ''}`)
    }
    // Save-as collision: strike shortcut vs Save As
    await q.close()
  })

  await section('typing', async () => {
    const q = await fresh('')
    const { page } = q
    await page.locator('.tiptap').click()
    const tests: Array<[string, string]> = [
      ['**bold** ', 'bold input rule'], ['*it* ', 'italic'], ['`code` ', 'code'], ['~~del~~ ', 'strike'], ['==hl== ', 'highlight'],
      ['x -> y -- z ... (c) 1/2 "q" \'s\'', 'typography'],
      ['H~2~O x^2^ ', 'sub/sup'], [':smile: ', 'emoji'], ['[txt](https://x.com) ', 'md link'], ['https://auto.example.com ', 'autolink'],
      ['![a](https://x.com/i.png) ', 'md image'], ['\n--- ', 'hr'], ['\n> quote', 'quote'],
    ]
    for (const [text, label] of tests) {
      await setMd(page, ''); await page.locator('.tiptap p').first().click()
      await page.keyboard.type(text, { delay: 5 })
      log(`type ${JSON.stringify(text)} (${label}) -> ${JSON.stringify(await md(page))}`)
    }
    await setMd(page, ''); await page.locator('.tiptap p').first().click()
    await page.keyboard.type('- [ ] task'); await page.keyboard.press('Enter'); await page.keyboard.type('next'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await page.keyboard.type('after')
    log('type task list: ' + JSON.stringify(await md(page)))
    await setMd(page, ''); await page.locator('.tiptap p').first().click()
    await page.keyboard.type('1. a'); await page.keyboard.press('Enter'); await page.keyboard.type('b'); await page.keyboard.press('Enter'); await page.keyboard.press('Tab'); await page.keyboard.type('nested'); await page.keyboard.press('Shift+Tab')
    log('type ordered+indent: ' + JSON.stringify(await md(page)))
    // literal characters serialisation
    for (const lit of ['*not em*', '# not heading', '1. not list', '[x](y)', '<b>', '- dash', '> gt', '_u_ snake_case_here', '$5 and $6', '| pipe |', '+ plus', '```ticks```', '&amp; amp', '==eq==', '~~tilde~~', '\\backslash', '[ ] box', '--- hr', 'a  b   c', '    four spaces']) {
      await setMd(page, '')
      await ed(page, (e: any, t: string) => e.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] }), lit)
      const out = await md(page)
      await setMd(page, out)
      const back = await ed(page, (e: any) => e.getText())
      log(`literal ${JSON.stringify(lit)} -> saved ${JSON.stringify(out)} -> reopened text ${JSON.stringify(back)} ${back.trim() === lit ? 'OK' : 'CHANGED'}`)
    }
    await q.close()
  })

  await section('chrome', async () => {
    const q = await fresh('# One\n\n## Two\n\ntext\n')
    const { page } = q
    log('DOM chrome ids/buttons: ' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('#app *, body > *')].filter(e => e.id).map(e => e.id).slice(0, 40))))
    log('spellcheck attr: ' + await page.evaluate(() => document.querySelector('.tiptap')!.getAttribute('spellcheck')))
    log('print css rules: ' + await page.evaluate(() => { let n = 0; for (const s of document.styleSheets) { try { for (const r of s.cssRules) if (r instanceof CSSMediaRule && r.conditionText.includes('print')) n++ } catch {} } return n }))
    log('title/word count present: ' + await page.evaluate(() => document.getElementById('word-count')?.textContent))
    // autosave behaviour: edit, wait, check file written?
    await page.locator('.tiptap p').last().click(); await page.keyboard.press('End'); await page.keyboard.type(' edit')
    await page.waitForTimeout(4000)
    log('after 4s idle edit: file on disk unchanged? ' + JSON.stringify(await q.readFile('/mock/doc/a.md')) + ' | draft in localStorage: ' + await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('quill-draft')).join(',')))
    // Cmd+S collision with strike
    await page.keyboard.press('Home'); await page.keyboard.press('Shift+End')
    const before = (await q.calls()).length
    await page.keyboard.press('Meta+Shift+s'); await page.waitForTimeout(300)
    log('Meta+Shift+S ipc: ' + JSON.stringify((await q.calls()).slice(before).map(c => c.cmd)) + ' md=' + JSON.stringify((await md(page)).split('\n').slice(-2)))
    // external change: modify file on disk; does Quill notice?
    await q.writeFile('/mock/doc/a.md', '# Rewritten externally\n')
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.waitForTimeout(500)
    log('external file change detected after window focus? md head=' + JSON.stringify((await md(page)).slice(0, 40)))
    await q.close()
  })

  await section('find', async () => {
    const q = await fresh('foo Foo FOO\n')
    await q.page.keyboard.press('Meta+f'); await q.page.waitForTimeout(200)
    await q.page.keyboard.type('foo'); await q.page.waitForTimeout(300)
    log('find bar match count text: ' + JSON.stringify(await q.page.evaluate(() => document.querySelector('.find-bar')?.textContent)))
    await q.close()
  })
}

main().then(() => { stopDevServer(); process.exit(0) }).catch(e => { console.error(e); stopDevServer(); process.exit(1) })
