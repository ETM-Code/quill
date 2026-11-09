// Links: click model, routing (anchor / external / markdown / local file /
// unsupported), heading ids, hover hint. Run: bun harness/ux-links.ts
import { Suite, launchUx, ed, uxCalls, shot, type Result } from './ux/driver'

const DOC = `# Intro

See [site](https://example.com), [rel](./other.md#setup), [anc](#heading-two), [pdf](./report%20v2.pdf), [up](../other/notes.md), [mail](mailto:a@b.com), [www](www.example.org), [vs](vscode://file/x), [dir](./sub/), [missing](./nope.md) and [app](./tool.sh).

## Heading Two

text

# Intro

${'filler paragraph\n\n'.repeat(40)}
## Last Section

end

${'tail paragraph\n\n'.repeat(30)}`

const FILES = {
  '/mock/doc/a.md': DOC,
  '/mock/doc/other.md': '# Other\n\n## Setup\n',
  '/mock/doc/report v2.pdf': '%PDF',
  '/mock/other/notes.md': '# Notes',
  '/mock/doc/tool.sh': 'echo hi',
}

export async function run(): Promise<Result[]> {
  const s = new Suite('links')
  const q = await launchUx({ files: FILES })
  const { page } = q
  const link = (href: string) => page.locator(`.tiptap a[href="${href}"]`).first()
  const lastCall = async () => (await uxCalls(q)).filter(c => c.cmd !== 'set_window_path').at(-1)

  await s.step('heading ids', async () => {
    const ids = await page.evaluate(() => [...document.querySelectorAll('.tiptap :is(h1,h2,h3)')].map(h => h.id))
    s.check('heading ids are GitHub slugs with dedupe', JSON.stringify(ids) === JSON.stringify(['intro', 'heading-two', 'intro-1', 'last-section']), ids)
  })

  await s.step('classification', async () => {
    const c = (h: string) => page.evaluate(h => (window as any).quillDebug.ux.classify(h), h)
    s.check('relative md + anchor', JSON.stringify(await c('./other.md#setup')) === JSON.stringify({ kind: 'markdown', path: '/mock/doc/other.md', anchor: 'setup' }), await c('./other.md#setup'))
    s.check('parent-relative md', (await c('../other/notes.md')).path === '/mock/other/notes.md')
    s.check('percent-decoded file', (await c('./report%20v2.pdf')).path === '/mock/doc/report v2.pdf')
    s.check('www gets https', (await c('www.example.org')).url === 'https://www.example.org')
    s.check('other scheme unsupported', (await c('vscode://file/x')).kind === 'unsupported')
    s.check('file: url', (await c('file:///mock/doc/other.md')).path === '/mock/doc/other.md')
  })

  await s.step('cmd-click routes', async () => {
    await link('https://example.com').click({ modifiers: ['Meta'] })
    await page.waitForTimeout(150)
    s.check('external opens browser', (await q.openedUrls()).includes('https://example.com'), await q.openedUrls())

    await link('www.example.org').click({ modifiers: ['Meta'] })
    await page.waitForTimeout(150)
    s.check('www opens https', (await q.openedUrls()).includes('https://www.example.org'))

    await link('./other.md#setup').click({ modifiers: ['Meta'] })
    await page.waitForTimeout(150)
    const c1 = await lastCall()
    s.check('relative md opens in Quill window with anchor', c1?.cmd === 'open_markdown_window' && c1.args.path === '/mock/doc/other.md' && c1.args.anchor === 'setup', c1)

    await link('./report%20v2.pdf').click({ modifiers: ['Meta'] })
    await page.waitForTimeout(150)
    const c2 = await lastCall()
    s.check('local file opens with default app', c2?.cmd === 'open_local_path' && c2.args.path === '/mock/doc/report v2.pdf', c2)

    await link('./tool.sh').click({ modifiers: ['Meta'] })
    await page.waitForTimeout(250)
    const shCalls = (await uxCalls(q)).filter(c => c.cmd === 'open_local_path' && c.args.path === '/mock/doc/tool.sh')
    s.check('script asks before opening (confirmed second call)', shCalls.length === 2 && shCalls[1].args.confirmed === true, shCalls)

    await link('./nope.md').click({ modifiers: ['Meta'] })
    await page.waitForTimeout(250)
    const toast = await page.evaluate(() => document.querySelector('#toast-container')?.textContent ?? '')
    s.check('missing file shows toast', /not found/i.test(toast), toast)

    // (the link mark drops non-allowlisted schemes on parse, so route directly)
    await page.evaluate(() => (window as any).quillDebug.ux.openLink('vscode://file/x'))
    await page.waitForTimeout(200)
    const toast2 = await page.evaluate(() => document.querySelector('#toast-container')?.textContent ?? '')
    s.check('unsupported scheme explains', /can't open vscode/i.test(toast2), toast2)
  })

  await s.step('anchor jump', async () => {
    await page.evaluate(() => (window as any).quillDebug.ux.openLink('#last-section'))
    await page.waitForTimeout(300)
    const r = await page.evaluate(() => {
      const ed = (window as any).quillDebug.editor
      const h = document.getElementById('last-section')!.getBoundingClientRect()
      return { parent: ed.state.selection.$from.parent.textContent, top: h.top }
    })
    s.check('#anchor puts caret in heading', r.parent === 'Last Section', r)
    s.check('#anchor scrolls heading near top', r.top > 30 && r.top < 140, r)
    await page.evaluate(() => (window as any).quillDebug.ux.openLink('#nonexistent'))
    await page.waitForTimeout(150)
    const toast = await page.evaluate(() => document.querySelector('#toast-container')?.textContent ?? '')
    s.check('unknown anchor toast', /No heading/.test(toast), toast)
    await page.evaluate(() => document.getElementById('editor-container')!.scrollTop = 0)
    await page.locator('.tiptap a[href="#heading-two"]').click({ modifiers: ['Meta'] })
    await page.waitForTimeout(200)
    s.check('cmd-click #anchor jumps', await ed(q, e => e.state.selection.$from.parent.textContent) === 'Heading Two')
  })

  await s.step('plain click popover', async () => {
    await page.evaluate(() => document.getElementById('editor-container')!.scrollTop = 0)
    const before = (await uxCalls(q)).length
    await link('./other.md#setup').click()
    await page.waitForTimeout(250)
    const pop = await page.evaluate(() => {
      const p = document.querySelector('.link-popover') as HTMLElement
      const open = p?.querySelector('.link-popover-open') as HTMLElement
      return { visible: !!p && getComputedStyle(p).display !== 'none' && p.offsetWidth > 0, label: p?.querySelector('.link-popover-url')?.textContent, action: open?.title }
    })
    s.check('plain click shows popover, does not open', pop.visible && (await uxCalls(q)).length === before, pop)
    s.check('popover names the action', pop.action === 'Open in Quill' && pop.label === 'other.md', pop)
    await shot(q, 'ux-links-popover-light')
    await page.locator('.link-popover .link-popover-open').click()
    await page.waitForTimeout(150)
    s.check('popover Open button routes', (await lastCall())?.cmd === 'open_markdown_window')
  })

  await s.step('mod hint', async () => {
    await link('https://example.com').hover()
    await page.keyboard.down('Meta')
    await page.waitForTimeout(50)
    const held = await page.evaluate(() => ({ cls: document.getElementById('editor')!.classList.contains('quill-mod-held'), cursor: getComputedStyle(document.querySelector('.tiptap a')!).cursor, title: document.getElementById('editor')!.title }))
    await page.keyboard.up('Meta')
    const released = await page.evaluate(() => getComputedStyle(document.querySelector('.tiptap a')!).cursor)
    s.check('⌘ held: pointer cursor on links', held.cls && held.cursor === 'pointer', held)
    s.check('plain hover: text cursor', released === 'text', released)
    s.check('hover tooltip names ⌘-click', /⌘-click to open/.test(held.title), held.title)
  })

  s.check('no console errors', q.consoleErrors.length === 0, q.consoleErrors)
  await q.close()

  // Dark popover screenshot
  const d = await launchUx({ files: FILES, colorScheme: 'dark' })
  await d.page.locator('.tiptap a[href="https://example.com"]').first().click()
  await d.page.waitForTimeout(250)
  await shot(d, 'ux-links-popover-dark')
  await d.close()
  return s.results
}

if (import.meta.main) {
  const r = await run()
  console.log(`${r.filter(x => x.ok).length}/${r.length} passed`)
  process.exit(r.every(x => x.ok) ? 0 : 1)
}
