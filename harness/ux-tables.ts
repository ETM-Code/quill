// UX scenarios for the table controls (alignment, hover +, delete by key, moves, header invariant).
// Run: bun harness/ux-tables.ts
import { Suite, bothSchemes, ed, launchUx, md, setMd, shot, type Result } from './ux/driver'
import type { Quill } from './gap-driver'

const BASE = ['| a | b | c |', '| --- | --- | --- |', '| 1 | 2 | 3 |', '| 4 | 5 | 6 |'].join('\n')

/** Parse a GFM table into body rows (trimmed cells) and the separator cells. */
function parse(markdown: string): { rows: string[][]; sep: string[] } {
  const lines = markdown.split('\n').filter(l => l.trim().startsWith('|'))
  const cells = (l: string): string[] => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
  const sep = lines.length > 1 ? cells(lines[1]) : []
  return { rows: lines.filter((_, i) => i !== 1).map(cells), sep }
}
const flat = (rows: string[][]): string => rows.map(r => r.join(',')).join(' / ')

const toolbarBtn = (q: Quill, title: string) => q.page.locator(`.bubble-menu button[title^="${title}"]`)
/** The toolbar refreshes on rAF; wait for it before reading active states. */
const isActive = async (q: Quill, title: string): Promise<boolean> => {
  await q.page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
  return toolbarBtn(q, title).evaluate(e => e.classList.contains('active'))
}
const cell = (q: Quill, row: number, col: number) => q.page.locator(`.tiptap tr:nth-child(${row + 1}) > :nth-child(${col + 1})`)

/** Header invariant straight from the DOM: row 0 all th, other rows all td. */
async function headerOk(q: Quill): Promise<boolean> {
  return q.page.evaluate(() => {
    const trs = [...document.querySelectorAll('.tiptap table tr')]
    return trs.length > 0 && trs.every((tr, i) => {
      const th = tr.querySelectorAll('th').length
      const td = tr.querySelectorAll('td').length
      return i === 0 ? th > 0 && td === 0 : th === 0 && td > 0
    })
  })
}

async function load(q: Quill, markdown: string): Promise<void> {
  await setMd(q, markdown)
  await q.page.waitForSelector('.tiptap table')
}

async function selectAllCells(q: Quill, rows: number, cols: number): Promise<void> {
  await cell(q, 0, 0).click()
  await cell(q, rows - 1, cols - 1).click({ modifiers: ['Shift'] })
}

export async function run(): Promise<Result[]> {
  const t = new Suite('tables')
  const q = await launchUx({ md: BASE })
  try {
    await load(q, BASE)

    // ---------------------------------------------------------- alignment
    await t.step('alignment buttons', async () => {
      await cell(q, 2, 1).click()
      t.check('align buttons present', (await toolbarBtn(q, 'Align column').count()) === 3)
      await toolbarBtn(q, 'Align column center').click()
      let p = parse(await md(q))
      t.check('center -> :---:', /^:-+:$/.test(p.sep[1]) && !/:/.test(p.sep[0]) && !/:/.test(p.sep[2]), p.sep)
      t.check('center active', await isActive(q, 'Align column center'))
      t.check('left not active', !(await isActive(q, 'Align column left')))
      t.check('cell renders centered', (await cell(q, 1, 1).evaluate(e => getComputedStyle(e).textAlign)) === 'center')

      await toolbarBtn(q, 'Align column right').click()
      p = parse(await md(q))
      t.check('right -> ---:', /^-+:$/.test(p.sep[1]), p.sep)

      await toolbarBtn(q, 'Align column left').click()
      p = parse(await md(q))
      t.check('left -> :---', /^:-+$/.test(p.sep[1]), p.sep)

      await toolbarBtn(q, 'Align column left').click() // active -> toggles off
      p = parse(await md(q))
      t.check('clicking active alignment clears it', /^-+$/.test(p.sep[1]), p.sep)
      t.check('body unchanged', flat(p.rows) === 'a,b,c / 1,2,3 / 4,5,6', p.rows)

      // Alignment follows the caret's column (applied to every row of it).
      await toolbarBtn(q, 'Align column right').click()
      await cell(q, 1, 0).click()
      t.check('right not active on other column', !(await isActive(q, 'Align column right')))
      await cell(q, 2, 1).click()
      t.check('right active on its column (from any row)', await isActive(q, 'Align column right'))

      // Multi-column cell selection aligns every selected column.
      await cell(q, 0, 0).click()
      await cell(q, 0, 2).click({ modifiers: ['Shift'] })
      await toolbarBtn(q, 'Align column center').click()
      p = parse(await md(q))
      t.check('cell selection aligns all columns', p.sep.every(s => /^:-+:$/.test(s)), p.sep)
    })

    // --------------------------------------------------------- hover + bars
    await t.step('hover add row / column', async () => {
      await load(q, BASE)
      await q.page.mouse.move(5, 5)
      t.check('bars hidden when not over a table', (await q.page.locator('.tbl-hover:not([hidden])').count()) === 0)
      await cell(q, 1, 1).hover()
      await q.page.waitForSelector('.tbl-hover-row:not([hidden])')
      t.check('row bar below table', await q.page.evaluate(() => {
        const bar = document.querySelector('.tbl-hover-row')!.getBoundingClientRect()
        const tb = document.querySelector('.tiptap table')!.getBoundingClientRect()
        return bar.top >= tb.bottom && bar.top - tb.bottom < 12 && Math.abs(bar.left - tb.left) < 2
      }))
      t.check('col bar right of table', await q.page.evaluate(() => {
        const bar = document.querySelector('.tbl-hover-col')!.getBoundingClientRect()
        const tb = document.querySelector('.tiptap table')!.getBoundingClientRect()
        return bar.left >= tb.right && bar.left - tb.right < 12 && Math.abs(bar.top - tb.top) < 2
      }))
      await q.page.locator('.tbl-hover-row .tbl-hover-btn').click()
      let p = parse(await md(q))
      t.check('row added (4 body rows incl header = 4 -> 5 lines)', p.rows.length === 4 && p.rows[3].every(c => c === ''), p.rows)
      t.check('caret moved into new row', await q.page.evaluate(() => {
        const a = window.getSelection()?.anchorNode
        const tr = (a instanceof Element ? a : a?.parentElement)?.closest('tr')
        return !!tr && tr === document.querySelector('.tiptap table tr:last-child')
      }))
      t.check('header still header', await headerOk(q))

      await cell(q, 1, 1).hover()
      await q.page.waitForSelector('.tbl-hover-col:not([hidden])')
      await q.page.locator('.tbl-hover-col .tbl-hover-btn').click()
      p = parse(await md(q))
      t.check('column added', p.rows.every(r => r.length === 4) && p.sep.length === 4, p)
      t.check('header still header after column add', await headerOk(q))

      // Moving away hides the bars.
      await q.page.mouse.move(5, 300)
      await q.page.waitForFunction(() => document.querySelectorAll('.tbl-hover:not([hidden])').length === 0, null, { timeout: 2000 })
      t.check('bars hide when pointer leaves', true)
    })

    // ------------------------------------------------------ delete by key
    await t.step('delete table by key', async () => {
      await load(q, `intro\n\n${BASE}\n\noutro`)
      await selectAllCells(q, 3, 3)
      t.check('selection is a CellSelection', await ed(q, e => e.state.selection.constructor.name.includes('CellSelection') || 'ranges' in e.state.selection && e.state.selection.$anchorCell !== undefined))
      await q.page.keyboard.press('Backspace')
      let m = await md(q)
      t.check('select-all-cells + Backspace removes table', !m.includes('|') && m.includes('intro') && m.includes('outro'), m)

      await load(q, `${BASE}\n\noutro`)
      await selectAllCells(q, 3, 3)
      await q.page.keyboard.press('Delete')
      m = await md(q)
      t.check('Delete removes table', !m.includes('|') && m.includes('outro'), m)

      await load(q, `${BASE}\n\noutro`)
      await cell(q, 1, 1).click()
      await ed(q, e => {
        let pos = -1
        e.state.doc.descendants((n: any, p: number) => { if (n.type.name === 'table') pos = p; return pos < 0 })
        e.commands.setNodeSelection(pos)
      })
      await q.page.keyboard.press('Backspace')
      m = await md(q)
      t.check('NodeSelection of table + Backspace removes it', !m.includes('|') && m.includes('outro'), m)

      // Partial selections must NOT delete the table.
      await load(q, BASE)
      await cell(q, 1, 0).click()
      await cell(q, 2, 2).click({ modifiers: ['Shift'] })
      await q.page.keyboard.press('Backspace')
      m = await md(q)
      t.check('partial cell selection keeps table', m.includes('|'), m)

      // Sole table: deleting it leaves a usable empty document.
      await load(q, BASE)
      await selectAllCells(q, 3, 3)
      await q.page.keyboard.press('Backspace')
      t.check('sole table deleted, editor still valid', !(await md(q)).includes('|') && (await q.page.locator('.tiptap').count()) === 1)
      await q.page.keyboard.type('hello')
      t.check('can type after deleting', (await md(q)).includes('hello'))
    })

    // ------------------------------------------------------------- moves
    await t.step('move row / column', async () => {
      await load(q, BASE)
      await cell(q, 1, 1).click()
      await q.page.keyboard.press('Meta+Alt+ArrowDown')
      let p = parse(await md(q))
      t.check('Cmd-Opt-Down moves row 1 down', flat(p.rows) === 'a,b,c / 4,5,6 / 1,2,3', p.rows)
      t.check('header intact after row move', await headerOk(q))
      t.check('caret still in moved cell (text 2)', await q.page.evaluate(() => {
        const a = window.getSelection()?.anchorNode
        const c = (a instanceof Element ? a : a?.parentElement)?.closest('td, th')
        return c?.textContent === '2'
      }))
      await q.page.keyboard.press('Meta+Alt+ArrowDown') // already last: no-op
      t.check('moving past the end is a no-op', flat(parse(await md(q)).rows) === 'a,b,c / 4,5,6 / 1,2,3')

      await q.page.keyboard.press('Meta+Alt+ArrowUp')
      await q.page.keyboard.press('Meta+Alt+ArrowUp') // body row 1 -> header position
      p = parse(await md(q))
      t.check('moving into position 0 swaps with header', flat(p.rows) === '1,2,3 / a,b,c / 4,5,6', p.rows)
      t.check('first row is the header, old header demoted', await headerOk(q))
      await q.page.keyboard.press('Meta+Alt+ArrowUp') // at top: no-op
      t.check('moving past the top is a no-op', flat(parse(await md(q)).rows) === '1,2,3 / a,b,c / 4,5,6')

      // Toolbar buttons
      await load(q, BASE)
      await cell(q, 2, 0).click()
      await toolbarBtn(q, 'Move row up').click()
      t.check('toolbar Move row up', flat(parse(await md(q)).rows) === 'a,b,c / 4,5,6 / 1,2,3')
      await toolbarBtn(q, 'Move row down').click()
      t.check('toolbar Move row down', flat(parse(await md(q)).rows) === 'a,b,c / 1,2,3 / 4,5,6')
      t.check('header intact after toolbar moves', await headerOk(q))

      // Columns (with alignment travelling along)
      await load(q, BASE)
      await cell(q, 1, 0).click()
      await toolbarBtn(q, 'Align column right').click()
      await q.page.keyboard.press('Meta+Alt+ArrowRight')
      p = parse(await md(q))
      t.check('Cmd-Opt-Right moves column', flat(p.rows) === 'b,a,c / 2,1,3 / 5,4,6', p.rows)
      t.check('alignment moved with the column', /^-+:$/.test(p.sep[1]) && !p.sep[0].includes(':'), p.sep)
      t.check('header intact after column move', await headerOk(q))
      await toolbarBtn(q, 'Move column left').click()
      t.check('toolbar Move column left', flat(parse(await md(q)).rows) === 'a,b,c / 1,2,3 / 4,5,6')
      await q.page.keyboard.press('Meta+Alt+ArrowLeft') // at left edge: no-op
      t.check('column move past the edge is a no-op', flat(parse(await md(q)).rows) === 'a,b,c / 1,2,3 / 4,5,6')

      // Whole-row selection moves together and keeps its selection.
      await load(q, BASE)
      await cell(q, 1, 0).click()
      await cell(q, 1, 2).click({ modifiers: ['Shift'] })
      await q.page.keyboard.press('Meta+Alt+ArrowDown')
      t.check('row selection moves', flat(parse(await md(q)).rows) === 'a,b,c / 4,5,6 / 1,2,3')
      t.check('still a cell selection', await ed(q, e => !!e.state.selection.$anchorCell))
    })

    // ------------------------------------------------------------ headers
    await t.step('header row invariant', async () => {
      await load(q, BASE)
      await cell(q, 1, 1).click()
      t.check('no "Toggle header row" button', (await q.page.locator('.bubble-menu button[title*="header" i]').count()) === 0)
      t.check('header ok initially', await headerOk(q))

      // Delete the header row: the next row becomes the header.
      await cell(q, 0, 0).click()
      await toolbarBtn(q, 'Delete row').click()
      let p = parse(await md(q))
      t.check('deleting header row promotes next row', flat(p.rows) === '1,2,3 / 4,5,6' && (await headerOk(q)), p.rows)

      // Add row above the header.
      await load(q, BASE)
      await cell(q, 0, 0).click()
      await toolbarBtn(q, 'Add row above').click()
      p = parse(await md(q))
      t.check('add row above header keeps one header row', p.rows.length === 4 && (await headerOk(q)), p.rows)

      // Add row below keeps body cells (not header cells).
      await load(q, BASE)
      await cell(q, 2, 0).click()
      await toolbarBtn(q, 'Add row below').click()
      t.check('add row below ok', (await headerOk(q)) && parse(await md(q)).rows.length === 4)

      // Programmatic toggleHeaderRow can't leave the table without a header either.
      await load(q, BASE)
      await cell(q, 1, 0).click()
      await ed(q, e => e.chain().focus().toggleHeaderRow().run())
      t.check('toggleHeaderRow command cannot break the invariant', await headerOk(q))
      p = parse(await md(q))
      t.check('markdown still a valid table', p.sep.length === 3 && p.rows.length === 3, p)

      // Undo restores.
      await q.page.keyboard.press('Meta+z')
      t.check('undo keeps header invariant', await headerOk(q))

      // Loading markdown keeps parsed alignment and header.
      await load(q, '| x | y |\n| :-- | --: |\n| 1 | 2 |')
      p = parse(await md(q))
      t.check('parsed alignment round-trips', /^:-+$/.test(p.sep[0]) && /^-+:$/.test(p.sep[1]), p.sep)
    })

    t.check('no console errors', q.consoleErrors.length === 0, q.consoleErrors)
  } finally {
    await q.close()
  }

  // -------------------------------------------------------- screenshots
  await t.step('screenshots', async () => {
    const shotMd = [
      '# Quarterly numbers', '',
      '| Region | Units | Revenue |', '| --- | --- | --- |',
      '| North | 1,204 | $48,160 |', '| South | 987 | $39,480 |', '| West | 1,530 | $61,200 |', '',
      'Notes below the table.',
    ].join('\n')
    await bothSchemes({ md: shotMd }, async (qq, scheme) => {
      await setMd(qq, shotMd)
      await qq.page.waitForSelector('.tiptap table')
      await qq.page.locator('.tiptap tr:nth-child(2) > :nth-child(2)').click()
      await qq.page.locator('.bubble-menu button[title="Align column right"]').click()
      await qq.page.locator('.tiptap tr:nth-child(3) > :nth-child(3)').hover()
      await qq.page.waitForSelector('.tbl-hover-row:not([hidden])')
      await qq.page.waitForTimeout(250)
      await shot(qq, `ux-table-${scheme}`)
      // Pointer on the row bar for the hot state.
      await qq.page.locator('.tbl-hover-row').hover()
      await qq.page.waitForTimeout(200)
      await shot(qq, `ux-table-${scheme}-hover-bar`)
      t.check(`screenshots ${scheme}`, qq.consoleErrors.length === 0, qq.consoleErrors)
    })
  })

  return t.results
}

if (import.meta.main) {
  const r = await run()
  const failed = r.filter(x => !x.ok)
  console.log(`\n${r.length - failed.length}/${r.length} passed`)
  process.exit(failed.length === 0 ? 0 : 1)
}
