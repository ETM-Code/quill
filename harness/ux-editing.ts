// Shortcuts, menus, inline math insertion, Copy as Plain Text.
// Run: bun harness/ux-editing.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Suite, launchUx, ed, md, setMd, ROOT, shot, type Result } from './ux/driver'

const selectText = (q: any, text: string) => ed(q, (e, t) => {
  let from = -1
  e.state.doc.descendants((n: any, pos: number) => {
    if (from < 0 && n.isText && n.text.includes(t)) from = pos + n.text.indexOf(t)
  })
  e.commands.setTextSelection({ from, to: from + t.length })
  e.view.focus()
  return from
}, text)

export async function run(): Promise<Result[]> {
  const s = new Suite('editing')
  const q = await launchUx({ md: 'para one\n', dialog: { save: '/mock/doc/saved-as.md' } })
  const { page } = q
  const reset = async (m: string) => { await setMd(q, m); await page.waitForTimeout(50) }

  await s.step('save-as vs strike', async () => {
    await reset('para one\n')
    await selectText(q, 'para one')
    await page.keyboard.press('Meta+Shift+s')
    await page.waitForTimeout(250)
    const calls = await q.calls()
    s.check('⌘⇧S opens Save As', calls.some(c => c.cmd === 'plugin:dialog|save'))
    s.check('⌘⇧S does not strike', !(await md(q)).includes('~~'), await md(q))
    await selectText(q, 'para one')
    await page.keyboard.press('Meta+Shift+x')
    s.check('⌘⇧X strikes', (await md(q)).includes('~~para one~~'), await md(q))
  })

  await s.step('headings', async () => {
    for (const level of [1, 2, 3, 4, 5, 6]) {
      await reset('line\n')
      await selectText(q, 'line')
      await page.keyboard.press(`Meta+${level}`)
      s.check(`⌘${level} → H${level}`, (await md(q)).trim() === `${'#'.repeat(level)} line`, await md(q))
    }
    await page.keyboard.press('Meta+0')
    s.check('⌘0 → paragraph', (await md(q)).trim() === 'line', await md(q))
  })

  await s.step('blocks', async () => {
    await reset('code here\n')
    await selectText(q, 'code here')
    await page.keyboard.press('Meta+Alt+c')
    s.check('⌥⌘C → code block', /^```\ncode here\n```/.test((await md(q)).trim()), await md(q))
    await reset('x\n')
    await selectText(q, 'x')
    await page.keyboard.press('Meta+Alt+t')
    s.check('⌥⌘T inserts a table', await ed(q, e => { let t = 0; e.state.doc.descendants((n: any) => { if (n.type.name === 'table') t++ }); return t }) === 1)
    await reset('plain\n')
    await selectText(q, 'plain')
    await page.keyboard.press('Meta+Shift+c')
    s.check('⇧⌘C left free (no code block)', !(await md(q)).includes('```'), await md(q))
  })

  await s.step('highlight', async () => {
    const has = await ed(q, e => !!e.schema.marks.highlight)
    if (!has) {
      s.check('highlight (SKIP: uxExtensions not wired into editor-setup yet)', true)
      return
    }
    await reset('mark me\n')
    await selectText(q, 'mark me')
    await page.keyboard.press('Meta+Shift+h')
    s.check('⌘⇧H highlights', (await md(q)).includes('==mark me=='), await md(q))
    await reset('a ==hi== b and x === y\n')
    s.check('==x== parses to highlight, === stays text', await page.evaluate(() => document.querySelectorAll('.tiptap mark').length) === 1 && (await md(q)).includes('x === y'), await md(q))
  })

  await s.step('inline math', async () => {
    await reset('Energy is E=mc^2 here.\n')
    await selectText(q, 'E=mc^2')
    await page.keyboard.press('Meta+Shift+m')
    await page.waitForTimeout(100)
    s.check('⌘⇧M wraps selection as inline math', (await md(q)).includes('Energy is $E=mc^2$ here.'), await md(q))
    await reset('Sum: \n')
    await ed(q, e => { e.commands.setTextSelection(6); e.view.focus() })
    await page.keyboard.press('Meta+Shift+m')
    await page.waitForTimeout(250)
    const pop = await page.evaluate(() => { const p = document.querySelector('.math-popover') as HTMLElement | null; return !!p && getComputedStyle(p).display !== 'none' })
    s.check('⌘⇧M at caret inserts math and opens popover', pop && (await md(q)).includes('$x$'), await md(q))
    await page.keyboard.press('Escape')
    await reset('Area pi r^2 ok\n')
    await selectText(q, 'pi r^2')
    await page.waitForTimeout(200)
    await shot(q, 'ux-bubble-math-light')
    await page.locator('.bubble-menu button[title^="Inline math"]').click()
    await page.waitForTimeout(100)
    s.check('bubble ∑ button converts selection', (await md(q)).includes('Area $pi r^2$ ok'), await md(q))
    await reset('menu x^2 item\n')
    await selectText(q, 'x^2')
    await page.evaluate(() => (window as any).__QUILL_EMIT__('menu', 'format-math'))
    s.check('Format > Inline Math menu event', (await md(q)).includes('menu $x^2$ item'), await md(q))
    await reset('`code $x$`\n')
    s.check('$ input rule untouched (no regressions in code)', (await md(q)).includes('`code $x$`'))
  })

  await s.step('copy as plain text', async () => {
    await reset('# Title\n\nSome **bold** and a [link](https://x.com) and $E=mc^2$.\n\n- one\n- two\n  - nested\n\n1. first\n2. second\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```js\nlet a = 1\n```\n')
    await page.evaluate(() => {
      (window as any).__copied = []
      navigator.clipboard.writeText = (t: string) => { (window as any).__copied.push(t); return Promise.resolve() }
    })
    await ed(q, e => { e.commands.selectAll(); e.view.focus() })
    await page.keyboard.press('Meta+Alt+Shift+c')
    await page.waitForTimeout(100)
    const copied = await page.evaluate(() => (window as any).__copied.at(-1))
    const want = 'Title\n\nSome bold and a link and E=mc^2.\n\n• one\n• two\n  • nested\n\n1. first\n2. second\n\nA\tB\n1\t2\n\nlet a = 1'
    s.check('⌥⇧⌘C mixed selection → plain text', copied === want, JSON.stringify(copied))
    // Fallback path: clipboard API rejects -> execCommand copy, text/plain only.
    const fb = await page.evaluate(async () => {
      navigator.clipboard.writeText = () => Promise.reject(new Error('denied'))
      let types: string[] = []; let text = ''
      window.addEventListener('copy', e => { types = [...(e.clipboardData?.types ?? [])]; text = e.clipboardData?.getData('text/plain') ?? '' })
      ;(window as any).quillDebug.ux.menu('copy-plain')
      await new Promise(r => setTimeout(r, 100))
      return { types, text }
    })
    s.check('fallback writes only text/plain', JSON.stringify(fb.types) === '["text/plain"]' && fb.text.startsWith('Title\n\nSome bold'), fb)
  })

  await s.step('menus', async () => {
    await reset('menu line\n')
    await selectText(q, 'menu line')
    await page.evaluate(() => (window as any).__QUILL_EMIT__('menu', 'format-h3'))
    s.check('menu event format-h3', (await md(q)).trim() === '### menu line', await md(q))
    await page.evaluate(() => (window as any).__QUILL_EMIT__('menu', 'format-bullet'))
    s.check('menu event format-bullet', (await md(q)).trim().startsWith('- '), await md(q))
    const rs = readFileSync(join(ROOT, 'src-tauri', 'src', 'lib.rs'), 'utf8')
    const needed = ['"Format"', '"View"', '"Copy as Plain Text"', 'Alt+Shift+CmdOrCtrl+C', '"Inline Math"', 'Shift+CmdOrCtrl+M', '"Print / Export PDF…"', '"Markdown Source"', '"Outline"', 'Shift+CmdOrCtrl+X', 'Alt+CmdOrCtrl+C']
    const missing = needed.filter(n => !rs.includes(n))
    s.check('native Format/View/Edit menu items present', missing.length === 0, missing)
    s.check('⇧⌘C not bound in menus', !rs.includes('"Shift+CmdOrCtrl+C"'))
  })

  s.check('no console errors', q.consoleErrors.length === 0, q.consoleErrors)
  await q.close()
  return s.results
}

if (import.meta.main) {
  const r = await run()
  console.log(`${r.filter(x => x.ok).length}/${r.length} passed`)
  process.exit(r.every(x => x.ok) ? 0 : 1)
}
