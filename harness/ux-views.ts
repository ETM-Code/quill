// UX scenarios for the views slice: source mode, outline, print.
//   bun harness/ux-views.ts
import { Suite, launchUx as launchRaw, md, setMd, ed, shot, uxCalls, type Result } from './ux/driver'

const filler = (n: number) =>
  Array.from({ length: n }, (_, i) => `Paragraph ${i + 1} lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore.`).join('\n\n')

const DOC = `# Alpha Title

Intro paragraph with a [link](https://example.com/docs) and **bold** text.

## Section One

${filler(8)}

### Sub One A

${filler(6)}

\`\`\`ts
const x: number = 1
console.log(x)
\`\`\`

## Section Two

| a | b |
| - | - |
| 1 | 2 |

${filler(8)}

#### Deep Four

${filler(10)}

# Omega Title

${filler(12)}
`

/** launchUx + wait for the startup document to finish loading. */
const launchUx: typeof launchRaw = async opts => {
  const q = await launchRaw(opts)
  if (opts?.md) {
    const probe = opts.md.trim().split('\n')[0].replace(/^#+\s*/, '').slice(0, 20)
    await q.page.waitForFunction((p: string) => (window as any).quillDebug.getMarkdown().includes(p), probe, { timeout: 10000 })
    await q.page.waitForTimeout(150)
  }
  return q
}

const keyMod = (q: any, k: string) => q.page.keyboard.press(`Meta+${k}`)
const slash = (q: any) => q.page.keyboard.press('Meta+Slash')

export async function run(): Promise<Result[]> {
  const t = new Suite('views')

  // ---------------------------------------------------------------- source
  await t.step('source mode', async () => {
    const q = await launchUx({ md: DOC })
    try {
      const orig = await md(q)
      await slash(q)
      await q.page.waitForSelector('.source-textarea', { state: 'visible' })
      const val = await q.page.inputValue('.source-textarea')
      t.check('textarea shows exactly getMarkdown()', val === orig, { len: val.length, orig: orig.length })
      t.check('editor hidden in source mode', !(await q.page.isVisible('#editor')))
      t.check('Markdown pill visible', await q.page.isVisible('.source-pill'))
      t.check('textarea focused', await q.page.evaluate(() => document.activeElement?.classList.contains('source-textarea')))
      t.check('spellcheck off', await q.page.evaluate(() => (document.querySelector('.source-textarea') as HTMLTextAreaElement).spellcheck === false))
      const geo = await q.page.evaluate(() => {
        const ta = document.querySelector('.source-textarea') as HTMLTextAreaElement
        const cs = getComputedStyle(ta)
        const ed = document.querySelector('#editor') as HTMLElement
        return { font: cs.fontFamily, pl: parseFloat(cs.paddingLeft), w: ta.clientWidth, edw: window.innerWidth }
      })
      t.check('column padding centers 720px', Math.abs(geo.w - 2 * geo.pl - 720) < 2, geo)

      // Esc does not exit
      await q.page.keyboard.press('Escape')
      t.check('Esc does not exit', await q.page.evaluate(() => (window as any).quillDebug.ux.sourceView.active))

      // toggle back with no edits: unchanged and clean
      await slash(q)
      await q.page.waitForSelector('.tiptap', { state: 'visible' })
      t.check('source off, editor visible', (await q.page.isVisible('#editor')) && !(await q.page.isVisible('.source-textarea')))
      t.check('no-edit toggle keeps markdown identical', (await md(q)) === orig)
      t.check('no-edit toggle keeps doc clean', !(await q.page.evaluate(() => (window as any).quillDebug.ux.isDirty())))

      // edit in source -> back
      await slash(q)
      await q.page.waitForSelector('.source-textarea', { state: 'visible' })
      await q.page.click('.source-textarea')
      await q.page.keyboard.press('Meta+ArrowUp')
      await q.page.keyboard.type('Added line from source\n\n')
      t.check('dirty after source edit', await q.page.evaluate(() => (window as any).quillDebug.ux.isDirty()))
      await q.page.waitForTimeout(500)
      t.check('debounced push into editor', (await md(q)).startsWith('Added line from source'), (await md(q)).slice(0, 60))
      await q.page.keyboard.press('Tab')
      const afterTab = await q.page.inputValue('.source-textarea')
      t.check('Tab inserts two spaces', afterTab.startsWith('Added line from source\n\n  # Alpha') || afterTab.includes('  # Alpha'), afterTab.slice(0, 50))
      await q.page.keyboard.press('Shift+Tab')
      t.check('Shift+Tab outdents', (await q.page.inputValue('.source-textarea')).includes('\n# Alpha') || (await q.page.inputValue('.source-textarea')).includes('\n\n# Alpha'))
      await slash(q)
      await q.page.waitForSelector('.tiptap', { state: 'visible' })
      const back = await md(q)
      t.check('editor content updated after toggle back', back.startsWith('Added line from source') && back.includes('# Alpha Title'), back.slice(0, 60))
      t.check('dirty after toggle back', await q.page.evaluate(() => (window as any).quillDebug.ux.isDirty()))
      t.check('editor focused after exit', await q.page.evaluate(() => document.activeElement?.classList.contains('ProseMirror')))
      t.check('no console errors (source)', q.consoleErrors.length === 0, q.consoleErrors)
    } finally { await q.close() }
  })

  await t.step('source: scroll proportional', async () => {
    const q = await launchUx({ md: DOC })
    try {
      await q.page.evaluate(() => { const c = document.getElementById('editor-container')!; c.scrollTop = (c.scrollHeight - c.clientHeight) / 2 })
      await q.page.waitForTimeout(100)
      await slash(q)
      await q.page.waitForTimeout(100)
      const r = await q.page.evaluate(() => { const t = document.querySelector('.source-textarea') as HTMLTextAreaElement; return t.scrollTop / (t.scrollHeight - t.clientHeight) })
      t.check('scroll ~50% carried into source', r > 0.35 && r < 0.65, r)
      await slash(q)
      await q.page.waitForTimeout(150)
      const r2 = await q.page.evaluate(() => { const c = document.getElementById('editor-container')!; return c.scrollTop / (c.scrollHeight - c.clientHeight) })
      t.check('scroll restored on exit (unchanged)', r2 > 0.4 && r2 < 0.6, r2)
    } finally { await q.close() }
  })

  await t.step('source then save', async () => {
    const q = await launchUx({ md: '# Hi\n\nbody\n', dialog: { save: '/mock/doc/a.md' } })
    try {
      await slash(q)
      await q.page.click('.source-textarea')
      await q.page.keyboard.press('Meta+ArrowDown')
      await q.page.keyboard.type('\nEDITED-IN-SOURCE\n')
      await keyMod(q, 's')
      await q.page.waitForTimeout(600)
      const saved = (await q.readFile('/mock/doc/a.md')) ?? ''
      t.check('⌘S saves edited source text (commit before save)', saved.includes('EDITED-IN-SOURCE'), saved)
      t.check('clean after save', !(await q.page.evaluate(() => (window as any).quillDebug.ux.isDirty())))
    } finally { await q.close() }
  })

  await t.step('source: external replace + menu', async () => {
    const q = await launchUx({ md: '# One\n' })
    try {
      await q.page.evaluate(() => (window as any).quillDebug.ux.menu('toggle-source'))
      t.check('menu toggle-source activates', await q.page.evaluate(() => (window as any).quillDebug.ux.sourceView.active))
      await setMd(q, '# Replaced\n\ntext\n')
      await q.page.waitForTimeout(100)
      t.check('textarea follows replaced document', (await q.page.inputValue('.source-textarea')).includes('# Replaced'))
      await q.page.evaluate(() => (window as any).quillDebug.ux.menu('toggle-source'))
      t.check('menu toggle-source deactivates', !(await q.page.evaluate(() => (window as any).quillDebug.ux.sourceView.active)))
    } finally { await q.close() }
  })

  // --------------------------------------------------------------- outline
  await t.step('outline', async () => {
    const q = await launchUx({ md: DOC })
    try {
      t.check('outline hidden by default', !(await q.page.isVisible('.outline')))
      await q.page.keyboard.press('Meta+Shift+KeyO')
      await q.page.waitForSelector('.outline', { state: 'visible' })
      const items = await q.page.$$eval('.outline-item', els => els.map(e => ({ t: e.textContent, l: Number((e as HTMLElement).dataset.level) })))
      t.check('headings listed with levels', JSON.stringify(items) === JSON.stringify([
        { t: 'Alpha Title', l: 1 }, { t: 'Section One', l: 2 }, { t: 'Sub One A', l: 3 },
        { t: 'Section Two', l: 2 }, { t: 'Deep Four', l: 4 }, { t: 'Omega Title', l: 1 },
      ]), items)
      const pads = await q.page.$$eval('.outline-item', els => els.map(e => parseFloat(getComputedStyle(e).paddingLeft)))
      t.check('indent grows with level', pads[0] < pads[1] && pads[1] < pads[2] && pads[4] > pads[2], pads)
      const lay = await q.page.evaluate(() => {
        const e = document.getElementById('editor')!.getBoundingClientRect()
        const n = document.querySelector('.outline')!.getBoundingClientRect()
        return { editorLeft: e.left, editorW: e.width, navRight: n.right, navW: n.width }
      })
      t.check('sidebar ~220px, does not overlap text', Math.abs(lay.navW - 220) < 2 && lay.editorLeft >= lay.navRight - 1, lay)
      t.check('first heading active at top', await q.page.evaluate(() => document.querySelector('.outline-item.active')?.textContent) === 'Alpha Title')

      // click navigates
      await q.page.click('.outline-item:has-text("Section Two")')
      await q.page.waitForTimeout(300)
      const nav = await q.page.evaluate(() => {
        const ed = (window as any).quillDebug.editor
        const $f = ed.state.selection.$from
        const h = document.querySelector('.tiptap')!.querySelectorAll('h2')
        const target = Array.from(h).find(x => x.textContent === 'Section Two') as HTMLElement
        const c = document.getElementById('editor-container')!.getBoundingClientRect()
        return {
          inHeading: $f.parent.type.name === 'heading' && $f.parent.textContent === 'Section Two',
          top: target.getBoundingClientRect().top - c.top,
          focused: document.activeElement?.classList.contains('ProseMirror'),
          active: document.querySelector('.outline-item.active')?.textContent,
        }
      })
      t.check('click puts selection inside heading', nav.inHeading, nav)
      t.check('heading scrolled near top', nav.top >= -2 && nav.top < 60, nav.top)
      t.check('editor focused after click', !!nav.focused)
      t.check('clicked item highlighted', nav.active === 'Section Two', nav.active)

      // scroll tracking
      await q.page.evaluate(() => { document.getElementById('editor-container')!.scrollTop = 0 })
      await q.page.waitForTimeout(150)
      t.check('scroll to top re-highlights first', await q.page.evaluate(() => document.querySelector('.outline-item.active')?.textContent) === 'Alpha Title')
      await q.page.evaluate(() => { const c = document.getElementById('editor-container')!; c.scrollTop = c.scrollHeight })
      await q.page.waitForTimeout(150)
      t.check('scroll to bottom highlights last', await q.page.evaluate(() => document.querySelector('.outline-item.active')?.textContent) === 'Omega Title')

      // doc change
      await ed(q, e => e.chain().focus('end').insertContent('<h2>Brand New Heading</h2><p>x</p>').run())
      await q.page.waitForTimeout(500)
      const texts = await q.page.$$eval('.outline-item', els => els.map(e => e.textContent))
      t.check('outline updates after adding heading', texts.includes('Brand New Heading') && texts.length === 7, texts)

      // persistence
      t.check('visible persisted', await q.page.evaluate(() => localStorage.getItem('quill.outline.visible')) === '1')
      await q.page.reload()
      await q.page.waitForSelector('.tiptap')
      await q.page.waitForTimeout(600)
      t.check('outline restored visible after reload', await q.page.isVisible('.outline'))
      t.check('restored outline populated', (await q.page.$$('.outline-item')).length === 6)

      // button toggles
      await q.page.click('.outline-toggle')
      t.check('titlebar button hides', !(await q.page.isVisible('.outline')))
      t.check('content margin released', await q.page.evaluate(() => getComputedStyle(document.getElementById('editor-container')!).marginLeft) === '0px')
      await q.page.click('.outline-toggle')
      t.check('titlebar button shows', await q.page.isVisible('.outline'))

      // narrow window keeps column usable
      await q.page.setViewportSize({ width: 900, height: 700 })
      await q.page.waitForTimeout(150)
      const narrow = await q.page.evaluate(() => {
        const e = document.getElementById('editor')!.getBoundingClientRect()
        return { left: e.left, right: e.right, w: e.width, sw: document.documentElement.scrollWidth, iw: window.innerWidth }
      })
      t.check('900px: no horizontal overflow, column inside window', narrow.sw <= narrow.iw && narrow.right <= narrow.iw && narrow.left >= 220, narrow)
      await q.page.setViewportSize({ width: 1100, height: 760 })

      // clicking in source mode returns to the editor
      await slash(q)
      await q.page.click('.outline-item:has-text("Omega")')
      await q.page.waitForTimeout(250)
      t.check('outline click exits source mode', !(await q.page.evaluate(() => (window as any).quillDebug.ux.sourceView.active)))
      t.check('no console errors (outline)', q.consoleErrors.length === 0, q.consoleErrors)
    } finally { await q.close() }
  })

  await t.step('outline empty state', async () => {
    const q = await launchUx({ md: 'just text\n' })
    try {
      await q.page.evaluate(() => (window as any).quillDebug.ux.menu('toggle-outline'))
      t.check('"No headings" shown', (await q.page.textContent('.outline-empty')) === 'No headings')
    } finally { await q.close() }
  })

  // ----------------------------------------------------------------- print
  await t.step('print', async () => {
    const q = await launchUx({ md: DOC })
    try {
      await keyMod(q, 'p')
      await q.page.waitForTimeout(300)
      const calls = await uxCalls(q)
      t.check('⌘P invokes print_window', calls.some(c => c.cmd === 'print_window'), calls.map(c => c.cmd))

      await q.page.keyboard.press('Meta+Shift+KeyO')
      await q.page.emulateMedia({ media: 'print' })
      const p = await q.page.evaluate(() => {
        const cs = (s: string) => getComputedStyle(document.querySelector(s)!)
        const vis = (s: string) => { const el = document.querySelector(s); return !el || getComputedStyle(el).display === 'none' }
        return {
          titlebarHidden: vis('#titlebar'), outlineHidden: vis('.outline'), headerHidden: vis('.code-block-header'),
          htmlOverflow: cs('html').overflow, bodyOverflow: cs('body').overflow, appOverflow: cs('#app').overflow,
          containerOverflow: cs('#editor-container').overflow, htmlHeight: cs('html').height,
          bg: cs('body').backgroundColor, color: cs('.tiptap p').color, edMax: cs('#editor').maxWidth,
          scrollH: document.documentElement.scrollHeight, innerH: window.innerHeight,
          linkAfter: getComputedStyle(document.querySelector('.tiptap a[href^="http"]')!, '::after').content,
          h2Break: cs('.tiptap h2').breakAfter, preBreak: cs('.code-block').breakInside, tableBreak: cs('.tiptap table').breakInside,
        }
      })
      t.check('titlebar hidden in print', p.titlebarHidden, p)
      t.check('outline + code header hidden in print', p.outlineHidden && p.headerHidden)
      t.check('html/body/#app/container overflow visible in print',
        [p.htmlOverflow, p.bodyOverflow, p.appOverflow, p.containerOverflow].every(o => o === 'visible'), p)
      t.check('all content paginates (document taller than viewport)', p.scrollH > p.innerH * 2, { scrollH: p.scrollH, innerH: p.innerH })
      t.check('white bg, black text', p.bg === 'rgb(255, 255, 255)' && p.color === 'rgb(0, 0, 0)', { bg: p.bg, color: p.color })
      t.check('full-width content', p.edMax === 'none', p.edMax)
      t.check('external link URL printed after text', p.linkAfter.includes('https://example.com/docs'), p.linkAfter)
      t.check('break rules', p.h2Break === 'avoid' && p.preBreak === 'avoid' && p.tableBreak === 'avoid', p)
      await shot(q, 'ux-views-print')
      await q.page.emulateMedia({ media: 'screen' })
      t.check('no console errors (print)', q.consoleErrors.length === 0, q.consoleErrors)
    } finally { await q.close() }
  })

  // ----------------------------------------------------------- screenshots
  await t.step('screenshots', async () => {
    for (const scheme of ['light', 'dark'] as const) {
      const q = await launchUx({ md: DOC, colorScheme: scheme })
      try {
      await q.page.keyboard.press('Meta+Shift+KeyO')
      await q.page.waitForTimeout(300)
      await q.page.click('.outline-item:has-text("Sub One A")')
      await q.page.waitForTimeout(300)
      await shot(q, `ux-views-outline-${scheme}`)
      await slash(q)
      await q.page.waitForTimeout(300)
      await shot(q, `ux-views-source-${scheme}`)
      t.check(`screenshots ${scheme}`, true)
      } finally { await q.close() }
    }
  })

  return t.results
}

if (import.meta.main) {
  const results = await run()
  const failed = results.filter(r => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  if (failed.length) for (const f of failed) console.log(`FAILED: ${f.name} — ${f.detail.slice(0, 300)}`)
  process.exit(failed.length ? 1 : 0)
}
