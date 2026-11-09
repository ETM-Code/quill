// Repro for the image-popover focus flake: edit alt + Enter, then re-click the image.
// Run: bun harness/ux-image-flaky.ts [runs]
import { launchUx, ed } from './ux/driver'
const DOC = 'Intro text.\n\n![a cat](assets/cat.png)\n\nAfter the image.\n'
const FILES = { '/mock/doc/a.md': DOC, '/mock/doc/assets/cat.png': '<png>' }
const popoverVisible = (q: any) => q.page.evaluate(() => { const p = document.querySelector('.image-popover') as HTMLElement | null; return !!p && getComputedStyle(p).display !== 'none' && getComputedStyle(p).visibility !== 'hidden' })
const runs = Number(process.argv[2] ?? 6)
let bad = 0
for (let i = 0; i < runs; i++) {
  const q = await launchUx({ files: FILES, colorScheme: 'light' })
  const img = q.page.locator('.tiptap img.quill-image').first()
  await q.page.evaluate(() => {
    const log: string[] = ((window as any).__log = [])
    const t0 = performance.now()
    const stamp = (m: string) => log.push(`${Math.round(performance.now() - t0)}ms ${m}`)
    for (const ev of ['pointerdown', 'mousedown', 'mouseup', 'click', 'focusin', 'focusout', 'selectionchange'])
      document.addEventListener(ev, e => stamp(`${ev} ${(e.target as HTMLElement)?.className?.toString?.().slice(0, 30) ?? ''}`), true)
    new MutationObserver(ms => { for (const m of ms) { const el = m.target as HTMLElement; stamp(`popover style: display=${el.style.display} vis=${el.style.visibility}`) } })
      .observe(document.querySelector('.image-popover')!, { attributes: true, attributeFilter: ['style'] })
    ;(window as any).__dbg = stamp
    const ed = (window as any).quillDebug.editor
    ed.on('selectionUpdate', () => stamp(`sel ${ed.state.selection.constructor.name}@${ed.state.selection.from}`))
  })
  await img.click(); await q.page.waitForTimeout(250)
  await q.page.fill('.image-popover-alt', 'A ginger cat')
  await q.page.press('.image-popover-alt', 'Enter')
  const sel = async () => ed(q, e => `${e.state.selection.constructor.name}@${e.state.selection.from}`)
  const s1 = await sel()
  await q.page.waitForTimeout(100)
  const s2 = await sel()
  await q.page.waitForTimeout(Number(process.env.GAP ?? 560)); await img.click(); await q.page.waitForTimeout(200)
  const vis = await popoverVisible(q)
  const s3 = await sel()
  if (!vis) { bad++; console.log((await q.page.evaluate(() => (window as any).__log)).join('\n')) }
  console.log(`run ${i}: afterEnter=${s1} +100ms=${s2} afterReclick=${s3} popover=${vis}`)
  await q.close()
}
console.log(`bad ${bad}/${runs}`)
process.exit(bad ? 1 : 0)
