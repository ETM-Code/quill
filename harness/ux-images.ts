// Images: click popover (alt, size, open, reveal, delete), ⌘-click and
// double-click open, resize handle, native drag-drop, unsaved-doc save
// prompt. Run: bun harness/ux-images.ts
import { Suite, launchUx, ed, md, uxCalls, shot, type Result } from './ux/driver'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const DOC = 'Intro text.\n\n![a cat](assets/cat.png)\n\nAfter the image.\n'
const FILES = { '/mock/doc/a.md': DOC, '/mock/doc/assets/cat.png': '<png>' }

const imageAttrs = (q: any) => ed(q, e => { let a: any = null; e.state.doc.descendants((n: any) => { if (n.type.name === 'image' && !a) a = n.attrs }); return a })
const imageCount = (q: any) => ed(q, e => { let c = 0; e.state.doc.descendants((n: any) => { if (n.type.name === 'image') c++ }); return c })
// ProseMirror turns two clicks within 500 ms into a double-click (which opens the image).
const reclick = async (q: any, img: any) => { await q.page.waitForTimeout(560); await img.click(); await q.page.waitForTimeout(200) }
const popoverVisible = (q: any) => q.page.evaluate(() => { const p = document.querySelector('.image-popover') as HTMLElement | null; return !!p && getComputedStyle(p).display !== 'none' && getComputedStyle(p).visibility !== 'hidden' })

export async function run(): Promise<Result[]> {
  const s = new Suite('images')

  for (const scheme of ['light', 'dark'] as const) {
    const q = await launchUx({ files: FILES, colorScheme: scheme })
    const img = q.page.locator('.tiptap img.quill-image').first()
    await img.click()
    await q.page.waitForTimeout(250)
    await shot(q, `ux-image-popover-${scheme}`)
    if (scheme === 'dark') { await q.close(); break }

    await s.step('popover', async () => {
      s.check('click shows popover', await popoverVisible(q))
      s.check('image is node-selected', await ed(q, e => e.state.selection.node?.type.name) === 'image')
      s.check('alt prefilled', await q.page.inputValue('.image-popover-alt') === 'a cat')
      await q.page.fill('.image-popover-alt', 'A ginger cat')
      await q.page.press('.image-popover-alt', 'Enter')
      await q.page.waitForTimeout(100)
      s.check('alt edit saved to markdown', (await md(q)).includes('![A ginger cat](assets/cat.png)'), await md(q))

      await reclick(q, img)
      await q.page.locator('.image-popover-size', { hasText: 'S' }).click()
      await q.page.waitForTimeout(100)
      const a1 = await imageAttrs(q)
      const w1 = await img.evaluate((el: HTMLImageElement) => Math.round(el.getBoundingClientRect().width))
      s.check('size S sets width 240', a1.width === 240 && w1 === 240, { attrs: a1, w1 })
      await q.page.locator('.image-popover-size', { hasText: 'Auto' }).click()
      await q.page.waitForTimeout(100)
      s.check('Auto clears width', (await imageAttrs(q)).width == null)

      await q.page.locator('.image-popover button[title="Open in Preview"]').click()
      await q.page.waitForTimeout(150)
      let calls = await uxCalls(q)
      s.check('Open → open_local_path(abs)', calls.some(c => c.cmd === 'open_local_path' && c.args.path === '/mock/doc/assets/cat.png'), calls)
      await reclick(q, img)
      await q.page.locator('.image-popover button[title="Show in Finder"]').click()
      await q.page.waitForTimeout(150)
      calls = await uxCalls(q)
      s.check('Reveal → reveal_local_path(abs)', calls.some(c => c.cmd === 'reveal_local_path' && c.args.path === '/mock/doc/assets/cat.png'), calls)
    })

    await s.step('open gestures', async () => {
      const count = async () => (await uxCalls(q)).filter(c => c.cmd === 'open_local_path').length
      const n0 = await count()
      await img.dblclick(); await q.page.waitForTimeout(200)
      s.check('double-click opens', await count() === n0 + 1)
      await img.click({ modifiers: ['Meta'] }); await q.page.waitForTimeout(200)
      s.check('⌘-click opens', await count() === n0 + 2)
    })

    await s.step('resize handle', async () => {
      await reclick(q, img)
      await q.page.keyboard.press('Escape')
      const box = (await q.page.locator('.quill-image-handle').first().boundingBox())!
      await q.page.mouse.move(box.x + 5, box.y + 5)
      await q.page.mouse.down()
      await q.page.mouse.move(box.x - 100, box.y + 5, { steps: 5 })
      await q.page.mouse.up()
      await q.page.waitForTimeout(100)
      const a = await imageAttrs(q)
      s.check('drag handle sets width ≈ natural - 100', typeof a.width === 'number' && a.width >= 200 && a.width <= 230, a)
    })

    await s.step('delete', async () => {
      await reclick(q, img)
      await q.page.locator('.image-popover button[title="Delete image"]').click()
      await q.page.waitForTimeout(100)
      s.check('delete removes image', await imageCount(q) === 0)
    })

    await s.step('native drop', async () => {
      await q.page.evaluate(() => (window as any).quillDebug.setMarkdown('First para.\n\nSecond para.\n'))
      const target = (await q.page.locator('.tiptap p').nth(1).boundingBox())!
      const pos = { x: target.x + 2, y: target.y + target.height / 2 }
      const n = await q.page.evaluate(([p]) => {
        const emit = (window as any).__QUILL_EMIT__
        emit('tauri://drag-over', { position: p })
        return emit('tauri://drag-drop', { paths: ['/Users/x/Desktop/my-chart.png', '/mock/doc/img/local shot.png', '/Users/x/spec.pdf'], position: p })
      }, [pos] as const)
      await q.page.waitForTimeout(400)
      const m = await md(q)
      const calls = await uxCalls(q)
      s.check('drop listener registered', n === 1, n)
      s.check('outside image copied via import_asset', calls.some(c => c.cmd === 'import_asset' && c.args.source === '/Users/x/Desktop/my-chart.png' && c.args.docDir === '/mock/doc'), calls.filter(c => c.cmd === 'import_asset'))
      s.check('images inserted at drop point with alt', /First para\.\n\n!\[my chart\]\(assets\/my-chart\.png\)!\[local shot\]\(img\/local%20shot\.png\)\[spec\.pdf\]\(\/Users\/x\/spec\.pdf\)Second para/.test(m), m)
      s.check('drop caret hidden after drop', await q.page.evaluate(() => getComputedStyle(document.querySelector('.drop-caret')!).display) === 'none')

      await q.page.evaluate(() => (window as any).__QUILL_EMIT__('tauri://drag-drop', { paths: ['/mock/other/notes.md'], position: { x: 10, y: 10 } }))
      await q.page.waitForTimeout(200)
      const c = (await uxCalls(q)).filter(c => c.cmd === 'open_markdown_window').at(-1)
      s.check('.md drop on a document opens a window', c?.args.path === '/mock/other/notes.md', c)
    })
    s.check('no console errors', q.consoleErrors.length === 0, q.consoleErrors)
    await q.close()
  }

  await s.step('untitled doc', async () => {
    const files = { '/mock/other/notes.md': '# Notes here\n' }
    // Pristine untitled window: a dropped .md loads in place.
    const q = await launchUx({ files, open: '' })
    await q.page.evaluate(() => (window as any).__QUILL_EMIT__('tauri://drag-drop', { paths: ['/mock/other/notes.md'], position: { x: 300, y: 200 } }))
    await q.page.waitForTimeout(300)
    s.check('.md drop on empty untitled loads here', await q.page.evaluate(() => (window as any).quillDebug.ux.path()) === '/mock/other/notes.md')
    await q.close()

    // Image drop into an untitled doc: prompt, Save As, then insert.
    const q2 = await launchUx({ files, open: '', dialog: { ask: true, save: '/mock/new/draft.md' } })
    await q2.page.keyboard.type('Hello')
    await q2.page.evaluate(() => (window as any).__QUILL_EMIT__('tauri://drag-drop', { paths: ['/Users/x/pic.png'], position: { x: 300, y: 120 } }))
    await q2.page.waitForTimeout(400)
    const calls = await q2.calls()
    s.check('untitled drop asks first', calls.some(c => c.cmd === 'plugin:dialog|ask'))
    s.check('then saves and imports next to new path', calls.some(c => c.cmd === 'import_asset' && (c.args as any).docDir === '/mock/new'), calls.map(c => c.cmd))
    s.check('image inserted after save', (await md(q2)).includes('![pic](assets/pic.png)'), await md(q2))
    s.check('saved file exists', (await q2.readFile('/mock/new/draft.md'))?.includes('Hello') ?? false)
    await q2.close()

    // Declining keeps the doc untouched.
    const q3 = await launchUx({ files, open: '', dialog: { ask: false } })
    await q3.page.keyboard.type('Hello')
    await q3.page.evaluate(() => (window as any).__QUILL_EMIT__('tauri://drag-drop', { paths: ['/Users/x/pic.png'], position: { x: 300, y: 120 } }))
    await q3.page.waitForTimeout(300)
    s.check('declined: no image, no save', !(await md(q3)).includes('![') && !(await q3.calls()).some(c => c.cmd === 'plugin:dialog|save'))
    await q3.close()

    // Paste into untitled goes through the same prompt.
    const q4 = await launchUx({ files, open: '', dialog: { ask: true, save: '/mock/new/pasted.md' } })
    await q4.page.evaluate(async (png: string) => {
      const el = document.querySelector('.tiptap') as HTMLElement
      el.focus()
      const bin = atob(png); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
      const dt = new DataTransfer(); dt.items.add(new File([u8], 'image.png', { type: 'image/png' }))
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
      await new Promise(r => setTimeout(r, 900))
    }, PNG)
    const m4 = await md(q4)
    s.check('paste into untitled: saved then inserted', /!\[\]\(assets\/img-[0-9a-f]{8}\.png\)/.test(m4) && (await q4.readFile('/mock/new/pasted.md')) !== undefined, m4)
    await q4.close()
  })

  return s.results
}

if (import.meta.main) {
  const r = await run()
  console.log(`${r.filter(x => x.ok).length}/${r.length} passed`)
  process.exit(r.every(x => x.ok) ? 0 : 1)
}
