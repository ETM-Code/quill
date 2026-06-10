// Feature flow tests: bubble menu, link popover, math popover, slash menu,
// find/replace, clipboard, save flows, draft recovery.
// Run: bun harness/features.ts
import { launchQuill, type Quill } from './driver'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const SHOTS = join(import.meta.dir, 'shots')
mkdirSync(SHOTS, { recursive: true })

let pass = 0
let fail = 0
const failures: string[] = []

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

async function md(q: Quill): Promise<string> {
  return q.page.evaluate(() => (window as any).quillDebug.getMarkdown())
}

async function scenarioBubbleMenu() {
  console.log('— bubble menu —')
  const q = await launchQuill({ files: { '/m/a.md': 'Hello brave new world\n' }, open: '/m/a.md' })
  const { page } = q

  await page.locator('.tiptap p').first().selectText()
  await page.waitForTimeout(300)
  const menu = page.locator('.bubble-menu')
  check('appears on selection', await menu.isVisible())

  await menu.locator('.bubble-btn[title^="Bold"]').click()
  await page.waitForTimeout(200)
  check('bold applies', (await md(q)).includes('**Hello brave new world**'))
  check('bold button shows active', await menu.locator('.bubble-btn[title^="Bold"]').evaluate(el => el.classList.contains('active')))

  await menu.locator('.bubble-btn[title^="Italic"]').click()
  await page.waitForTimeout(200)
  check('italic stacks', /\*\*\*|\*\*_|_\*\*/.test(await md(q)))

  // Turn into heading via dropdown
  await menu.locator('.bubble-turninto').click()
  await page.waitForTimeout(150)
  await page.locator('.bubble-dropdown-item:has-text("Heading 1")').click()
  await page.waitForTimeout(200)
  check('turn-into heading', (await md(q)).startsWith('# '))

  await page.screenshot({ path: join(SHOTS, 'feat-bubble.png') })

  // Hide on caret collapse
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(250)
  check('hides when selection collapses', !(await menu.isVisible()))

  check('no console errors', q.consoleErrors.length === 0, q.consoleErrors.join('|'))
  await q.close()
}

async function scenarioLinks() {
  console.log('— links —')
  const q = await launchQuill({ files: { '/m/l.md': 'Go to [Tauri](https://tauri.app) now.\n' }, open: '/m/l.md' })
  const { page } = q

  // Plain click -> popover with URL, not navigation
  await page.locator('.tiptap a').click()
  await page.waitForTimeout(300)
  const popover = page.locator('.link-popover')
  check('click shows popover', await popover.isVisible())
  check('popover shows url', (await popover.locator('.link-popover-url').textContent())?.includes('tauri.app') ?? false)
  await page.screenshot({ path: join(SHOTS, 'feat-link-popover.png') })

  // Open via popover URL click
  await popover.locator('.link-popover-url').click()
  await page.waitForTimeout(200)
  check('popover url click opens externally', (await q.openedUrls()).includes('https://tauri.app'))

  // Edit link via popover
  await page.locator('.tiptap a').click()
  await page.waitForTimeout(250)
  await popover.locator('button[title="Edit link"]').click()
  const input = popover.locator('.link-popover-input')
  await input.fill('example.com/docs')
  await input.press('Enter')
  await page.waitForTimeout(200)
  check('edit rewrites href (https added)', (await md(q)).includes('](https://example.com/docs)'))

  // Cmd+K on selection creates link
  await page.keyboard.press('Meta+ArrowDown')
  await page.keyboard.type(' Visit site')
  // select "site"
  for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowLeft')
  await page.keyboard.press('Meta+k')
  await page.waitForTimeout(250)
  check('cmd+k opens editor popover', await popover.locator('.link-popover-input').isVisible())
  await popover.locator('.link-popover-input').fill('quill.app')
  await popover.locator('.link-popover-input').press('Enter')
  await page.waitForTimeout(200)
  check('cmd+k creates link', (await md(q)).includes('[site](https://quill.app)'), await md(q))

  // Remove link
  await page.locator('.tiptap a').first().click()
  await page.waitForTimeout(250)
  await popover.locator('button[title="Remove link"]').click()
  await page.waitForTimeout(200)
  check('remove link strips markdown link', !(await md(q)).includes('example.com'))

  check('no console errors', q.consoleErrors.length === 0, q.consoleErrors.join('|'))
  await q.close()
}

async function scenarioMath() {
  console.log('— math —')
  const q = await launchQuill({ files: { '/m/m.md': 'Energy: $E = mc^2$\n\n$$\\sum_{i=1}^n i$$\n' }, open: '/m/m.md' })
  const { page } = q

  await page.locator('.tiptap-mathematics-render').first().click()
  await page.waitForTimeout(300)
  const popover = page.locator('.math-popover')
  check('inline math opens popover', await popover.isVisible())
  const textarea = popover.locator('.math-popover-input')
  check('latex prefilled', (await textarea.inputValue()) === 'E = mc^2')

  await textarea.fill('E = h\\nu')
  await page.waitForTimeout(300)
  check('live preview renders', (await popover.locator('.math-popover-preview .katex').count()) > 0)
  await page.screenshot({ path: join(SHOTS, 'feat-math-popover.png') })

  await textarea.press('Enter')
  await page.waitForTimeout(200)
  check('edit commits to markdown', (await md(q)).includes('$E = h\\nu$'))

  // Block math edit
  await page.locator('.tiptap-mathematics-render[data-type="block-math"]').click()
  await page.waitForTimeout(300)
  check('block math opens popover', await popover.isVisible())
  await textarea.press('Escape')
  await page.waitForTimeout(150)
  check('escape closes without change', (await md(q)).includes('\\sum_{i=1}^n i'))

  check('no console errors', q.consoleErrors.length === 0, q.consoleErrors.join('|'))
  await q.close()
}

async function scenarioSlashMenu() {
  console.log('— slash menu —')
  const q = await launchQuill({})
  const { page } = q

  await page.locator('.tiptap').click()
  await page.keyboard.type('/')
  await page.waitForTimeout(250)
  const menu = page.locator('.slash-menu')
  check('opens on slash', await menu.isVisible())
  await page.screenshot({ path: join(SHOTS, 'feat-slash.png') })

  await page.keyboard.type('head')
  await page.waitForTimeout(250)
  const labels = await menu.locator('.slash-menu-label').allTextContents()
  check('filters to headings', labels.length === 3 && labels.every(l => l.startsWith('Heading')), labels.join(','))

  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(250)
  await page.keyboard.type('Subtitle')
  check('applies heading 2 and removes query', (await md(q)).trim() === '## Subtitle')

  // table via slash
  await page.keyboard.press('Meta+ArrowDown')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/table')
  await page.waitForTimeout(250)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(250)
  check('inserts table', (await md(q)).includes('| '))

  // escape closes
  await page.keyboard.press('Meta+ArrowDown')
  await page.keyboard.type('/')
  await page.waitForTimeout(200)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  check('escape closes menu', !(await menu.isVisible()))

  check('no console errors', q.consoleErrors.length === 0, q.consoleErrors.join('|'))
  await q.close()
}

async function scenarioFindReplace() {
  console.log('— find/replace —')
  const content = 'alpha beta gamma\n\nbeta again, beta forever.\n'
  const q = await launchQuill({ files: { '/m/f.md': content }, open: '/m/f.md' })
  const { page } = q

  await page.keyboard.press('Meta+f')
  await page.waitForTimeout(200)
  const bar = page.locator('.find-bar')
  check('cmd+f opens find bar', await bar.isVisible())

  await bar.locator('.find-bar-input').first().fill('beta')
  await page.waitForTimeout(350)
  check('match count shown', (await bar.locator('.find-bar-count').textContent()) === '1/3')
  check('matches highlighted', (await page.locator('.find-match').count()) === 3)
  await page.screenshot({ path: join(SHOTS, 'feat-find.png') })

  await bar.locator('.find-bar-input').first().press('Enter')
  await page.waitForTimeout(150)
  check('enter steps to next', (await bar.locator('.find-bar-count').textContent()) === '2/3')

  // replace flow
  await page.keyboard.press('Meta+Alt+f')
  await page.waitForTimeout(200)
  const replaceInput = bar.locator('.find-bar-input').nth(1)
  await replaceInput.fill('delta')
  await bar.locator('.find-bar-btn:has-text("All")').click()
  await page.waitForTimeout(250)
  const out = await md(q)
  check('replace all works', !out.includes('beta') && out.split('delta').length === 4, out)

  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  check('escape closes and clears highlights', (await page.locator('.find-match').count()) === 0)

  check('no console errors', q.consoleErrors.length === 0, q.consoleErrors.join('|'))
  await q.close()
}

async function scenarioClipboard() {
  console.log('— clipboard —')
  const q = await launchQuill({ files: { '/m/c.md': '# Title\n\nSome **bold** text here.\n' }, open: '/m/c.md' })
  const { page } = q

  // copy whole doc -> plain-text clipboard serializer should emit markdown
  // (WebKit denies real clipboard reads in automation, so call the
  // clipboardTextSerializer prop directly on the selected slice.)
  await page.locator('.tiptap').click()
  await page.keyboard.press('Meta+a')
  const clip = await page.evaluate(() => {
    const editor = (window as any).quillDebug.editor
    const slice = editor.state.selection.content()
    let out = ''
    editor.view.someProp('clipboardTextSerializer', (fn: any) => {
      out = fn(slice, editor.view)
      return true
    })
    return out
  })
  check('copy puts markdown on clipboard', clip.includes('# Title') && clip.includes('**bold**'), JSON.stringify(clip))

  // paste markdown text becomes rich content
  await page.keyboard.press('Meta+ArrowDown')
  await page.keyboard.press('Enter')
  await page.evaluate(async () => {
    const dt = new DataTransfer()
    dt.setData('text/plain', '## Pasted\n\n- item one\n- item two\n\n```js\nlet x = 1\n```\n')
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
    document.querySelector('.tiptap')!.dispatchEvent(ev)
  })
  await page.waitForTimeout(400)
  const out = await md(q)
  check('pasted markdown parsed to blocks', out.includes('## Pasted') && out.includes('- item one') && out.includes('```js'), out)
  const hl = await page.locator('.code-block .hljs-keyword').count()
  check('pasted code got highlighted (lazy grammar)', hl > 0)

  check('no console errors', q.consoleErrors.length === 0, q.consoleErrors.join('|'))
  await q.close()
}

async function scenarioCodeBlock() {
  console.log('— code block controls —')
  const q = await launchQuill({ files: { '/m/k.md': '```python\nprint("hi")\n```\n' }, open: '/m/k.md' })
  const { page } = q
  await page.waitForTimeout(500)

  const block = page.locator('.code-block')
  check('header renders', await block.locator('.code-block-header').isVisible())
  check('language select shows python', (await block.locator('.code-block-lang').inputValue()) === 'python')
  check('python highlighted lazily', (await block.locator('.hljs-built_in, .hljs-title, .hljs-string').count()) > 0)

  await page.evaluate(() => {
    ;(window as any).__copied = []
    const stub = (t: string) => { (window as any).__copied.push(t); return Promise.resolve() }
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: stub }, configurable: true })
  })
  await block.locator('.code-block-copy').click()
  await page.waitForTimeout(150)
  const clip = await page.evaluate(() => (window as any).__copied[0])
  check('copy button copies code', clip === 'print("hi")', JSON.stringify(clip))

  await block.locator('.code-block-lang').selectOption('rust')
  await page.waitForTimeout(400)
  check('language change persists to markdown', (await md(q)).includes('```rust'))
  await page.screenshot({ path: join(SHOTS, 'feat-codeblock.png') })

  check('no console errors', q.consoleErrors.length === 0, q.consoleErrors.join('|'))
  await q.close()
}

async function scenarioSaveFlows() {
  console.log('— save flows —')
  const q = await launchQuill({ files: { '/m/s.md': 'start\n' }, open: '/m/s.md', dialog: { save: '/m/saved-as.md' } })
  const { page } = q

  await page.locator('.tiptap').click()
  await page.keyboard.press('Meta+ArrowDown')
  await page.keyboard.type(' more')
  await page.waitForTimeout(300)
  check('dirty dot appears', await page.locator('#modified-indicator').isVisible())

  await page.keyboard.press('Meta+s')
  await page.waitForTimeout(300)
  check('cmd+s writes to existing path', ((await q.readFile('/m/s.md')) ?? '').includes('start more'))
  check('dirty dot clears after save', !(await page.locator('#modified-indicator').isVisible()))

  await page.keyboard.type(' and more')
  await page.keyboard.press('Meta+Shift+s')
  await page.waitForTimeout(300)
  check('save-as writes to dialog path', ((await q.readFile('/m/saved-as.md')) ?? '').includes('and more'))
  const filename = await page.locator('#filename').textContent()
  check('filename updates after save-as', filename === 'saved-as.md', filename ?? '')

  // word count
  const wc = await page.locator('#word-count').textContent()
  check('word count shows', /\d+ words?/.test(wc ?? ''), wc ?? '')

  check('no console errors', q.consoleErrors.length === 0, q.consoleErrors.join('|'))
  await q.close()
}

async function scenarioTableControls() {
  console.log('— table controls —')
  const q = await launchQuill({ files: { '/m/t.md': '| a | b |\n|---|---|\n| 1 | 2 |\n' }, open: '/m/t.md' })
  const { page } = q

  // caret (no selection) inside a table cell -> table toolbar appears
  await page.locator('.tiptap td').first().click()
  await page.waitForTimeout(400)
  const menu = page.locator('.bubble-menu')
  check('toolbar appears with caret in table', await menu.isVisible())
  check('turn-into hidden in table-caret mode', !(await menu.locator('.bubble-turninto').isVisible()))
  check('add-row button visible', await menu.locator('.bubble-btn[title^="Add row below"]').isVisible())
  await page.screenshot({ path: join(SHOTS, 'feat-table-toolbar.png') })

  await menu.locator('.bubble-btn[title^="Add row below"]').click()
  await page.waitForTimeout(250)
  check('add row works', (await page.locator('.tiptap tr').count()) === 3)

  await menu.locator('.bubble-btn[title="Add column right"]').click()
  await page.waitForTimeout(250)
  check('add column works', (await page.locator('.tiptap tr').first().locator('th,td').count()) === 3)

  await menu.locator('.bubble-btn[title="Delete column"]').click()
  await page.waitForTimeout(250)
  check('delete column works', (await page.locator('.tiptap tr').first().locator('th,td').count()) === 2)

  // toolbar hides when caret leaves the table
  await page.keyboard.press('Meta+ArrowDown')
  await page.waitForTimeout(350)
  check('toolbar hides outside table', !(await menu.isVisible()))

  await page.locator('.tiptap td').first().click()
  await page.waitForTimeout(350)
  await menu.locator('.bubble-btn[title="Delete table"]').click()
  await page.waitForTimeout(250)
  check('delete table works', (await page.locator('.tiptap table').count()) === 0)

  check('no console errors', q.consoleErrors.length === 0, q.consoleErrors.join('|'))
  await q.close()
}

async function scenarioMathTyping() {
  console.log('— math typing —')
  const q = await launchQuill({})
  const { page } = q

  await page.locator('.tiptap').click()
  await page.keyboard.type('Energy is $E=mc^2$')
  await page.waitForTimeout(400)
  check('typed $...$ becomes inline math', (await page.locator('.tiptap-mathematics-render').count()) === 1)
  check('latex survives round-trip', (await md(q)).includes('$E=mc^2$'))

  await page.keyboard.press('Enter')
  await page.keyboard.type('costs $5 and $10 today')
  await page.waitForTimeout(300)
  check('prices not converted to math', (await page.locator('.tiptap-mathematics-render').count()) === 1)

  await page.keyboard.press('Enter')
  await page.keyboard.type('$$\\sum_{i=1}^n i$$')
  await page.waitForTimeout(400)
  check('typed $$...$$ becomes block math', (await page.locator('.tiptap-mathematics-render[data-type="block-math"]').count()) === 1)

  // slash menu math opens the editor popover immediately
  await page.keyboard.press('Meta+ArrowDown')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/inline')
  await page.waitForTimeout(300)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  check('slash math opens latex popover', await page.locator('.math-popover').isVisible())
  await page.keyboard.type('a^2+b^2=c^2')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  check('popover commit writes latex', (await md(q)).includes('$a^2+b^2=c^2$'))

  check('no console errors', q.consoleErrors.length === 0, q.consoleErrors.join('|'))
  await q.close()
}

async function scenarioShortcuts() {
  console.log('— keyboard shortcuts —')
  const q = await launchQuill({ files: { '/m/sc.md': 'hello world\n' }, open: '/m/sc.md', dialog: { ask: true } })
  const { page } = q

  // Cmd+B / Cmd+I (ProseMirror built-ins)
  await page.locator('.tiptap p').first().selectText()
  await page.keyboard.press('Meta+b')
  await page.waitForTimeout(150)
  check('cmd+b bolds', (await md(q)).includes('**hello world**'))
  await page.keyboard.press('Meta+i')
  await page.waitForTimeout(150)
  check('cmd+i italicizes', /\*\*\*|_\*\*|\*\*_/.test(await md(q)))
  await page.keyboard.press('Meta+i')
  await page.keyboard.press('Meta+b')

  // Cmd+E inline code
  await page.keyboard.press('Meta+e')
  await page.waitForTimeout(150)
  check('cmd+e toggles inline code', (await md(q)).includes('`hello world`'))
  await page.keyboard.press('Meta+e')

  // Cmd+Z undo / Shift+Cmd+Z redo
  await page.keyboard.press('Meta+ArrowDown')
  await page.keyboard.type(' extra')
  await page.waitForTimeout(150)
  check('typing applied', (await md(q)).includes('hello world extra'))
  await page.keyboard.press('Meta+z')
  await page.waitForTimeout(150)
  check('cmd+z undoes', !(await md(q)).includes('extra'))
  await page.keyboard.press('Meta+Shift+z')
  await page.waitForTimeout(150)
  check('shift+cmd+z redoes', (await md(q)).includes('extra'))

  // Cmd+N new file (dirty -> mock confirms discard)
  await page.keyboard.press('Meta+n')
  await page.waitForTimeout(300)
  check('cmd+n clears to untitled', (await page.locator('#filename').textContent()) === 'untitled.md')
  check('cmd+n empties doc', (await md(q)).trim() === '')

  // Cmd+O open via dialog
  await q.writeFile('/m/other.md', '# Other doc\n')
  await q.setDialog({ open: '/m/other.md' })
  await page.keyboard.press('Meta+o')
  await page.waitForTimeout(400)
  check('cmd+o opens dialog file', (await md(q)).includes('# Other doc'))
  check('cmd+o updates filename', (await page.locator('#filename').textContent()) === 'other.md')

  check('no console errors', q.consoleErrors.length === 0, q.consoleErrors.join('|'))
  await q.close()
}

async function scenarioDrafts() {
  console.log('— draft recovery —')
  // Simulate a crash: set a draft in localStorage newer than the file
  const q = await launchQuill({ files: { '/m/d.md': 'original content\n' } })
  await q.page.evaluate(() => {
    localStorage.setItem(
      'quill-draft:/m/d.md',
      JSON.stringify({ markdown: 'recovered draft content\n', time: Date.now() }),
    )
  })
  await q.page.goto('http://localhost:1420/?open=' + encodeURIComponent('/m/d.md'))
  await q.page.waitForSelector('.tiptap')
  await q.page.waitForTimeout(600)

  const toast = q.page.locator('.toast')
  check('draft toast appears', await toast.isVisible())
  await toast.locator('.toast-action').click()
  await q.page.waitForTimeout(300)
  check('restore loads draft', (await md(q)).includes('recovered draft'))

  check('no console errors', q.consoleErrors.length === 0, q.consoleErrors.join('|'))
  await q.close()
}

async function main() {
  await scenarioBubbleMenu()
  await scenarioLinks()
  await scenarioMath()
  await scenarioSlashMenu()
  await scenarioFindReplace()
  await scenarioClipboard()
  await scenarioCodeBlock()
  await scenarioSaveFlows()
  await scenarioTableControls()
  await scenarioMathTyping()
  await scenarioShortcuts()
  await scenarioDrafts()

  console.log(`\n${pass} passed, ${fail} failed`)
  if (failures.length) {
    console.log('FAILURES:')
    for (const f of failures) console.log(' -', f)
  }
  process.exit(fail ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
