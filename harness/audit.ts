// Baseline audit: reproduce the reported problems against the current build.
// Run: bun harness/audit.ts
import { launchQuill } from './driver'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const SHOTS = join(import.meta.dir, 'shots')
mkdirSync(SHOTS, { recursive: true })

const SAMPLE = `# Quill audit doc

Some **bold**, some *italic*, some \`inline code\`.

A link to [the Tauri site](https://tauri.app) lives here.

Inline math $E = mc^2$ and a block:

$$
\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}
$$

\`\`\`python
def hello(name):
    return f"hi {name}"
\`\`\`

- [ ] a task item
- [x] a done task

| a | b |
|---|---|
| 1 | 2 |

> a quote to end on
`

async function main() {
  const findings: string[] = []
  let lastErrCount = 0
  const checkErrs = (label: string) => {
    if (q.consoleErrors.length > lastErrCount) {
      findings.push(`!! errors appeared during "${label}": ${q.consoleErrors.slice(lastErrCount).join(' | ').slice(0, 200)}`)
      lastErrCount = q.consoleErrors.length
    }
  }
  const q = await launchQuill({
    files: { '/mock/sample.md': SAMPLE },
    open: '/mock/sample.md',
  })
  const { page } = q

  await page.waitForTimeout(800)
  await page.screenshot({ path: join(SHOTS, 'audit-01-open-light.png') })
  checkErrs('open')

  // 1. Formatting bar: select text, see if any toolbar/bubble appears
  await page.locator('.tiptap p').first().selectText()
  await page.waitForTimeout(500)
  const bubbleCount = await page.locator('[data-bubble-menu], .bubble-menu, [role="toolbar"]').count()
  findings.push(`formatting bar on selection: ${bubbleCount > 0 ? 'present' : 'ABSENT'}`)
  await page.screenshot({ path: join(SHOTS, 'audit-02-selection.png') })
  checkErrs('selection')

  // 2. Links: plain click and Cmd+click
  const link = page.locator('.tiptap a').first()
  if (await link.count()) {
    await link.click()
    await page.waitForTimeout(300)
    let urls = await q.openedUrls()
    findings.push(`plain click on link opened url: ${urls.length > 0 ? urls.join(',') : 'NO'}`)
    await link.click({ modifiers: ['Meta'] })
    await page.waitForTimeout(300)
    urls = await q.openedUrls()
    findings.push(`cmd+click on link opened url: ${urls.length > 0 ? urls.join(',') : 'NO'}`)
  checkErrs('link clicks')
  } else {
    findings.push('no <a> link rendered for [text](url) markdown!')
  }

  // 3. Math editing: click inline math, check for native prompt()
  let sawDialog = ''
  page.once('dialog', async d => {
    sawDialog = `${d.type()}: "${d.message()}"`
    await d.dismiss()
  })
  const math = page.locator('.tiptap-mathematics-render').first()
  if (await math.count()) {
    await math.click()
    await page.waitForTimeout(400)
    findings.push(`clicking math node: ${sawDialog ? `native ${sawDialog}` : 'no native dialog'}`)
  checkErrs('math click')
  } else {
    findings.push('no math node rendered!')
  }

  // 4. Task list + table rendering
  const checkboxes = await page.locator('.tiptap input[type="checkbox"]').count()
  findings.push(`task list checkboxes rendered: ${checkboxes}`)
  const tables = await page.locator('.tiptap table').count()
  findings.push(`tables rendered: ${tables}`)

  // 5. Code highlighting present for the fence?
  const hl = await page.locator('.tiptap pre [class*="hljs"], .tiptap pre .token').count()
  findings.push(`syntax highlight spans in code block: ${hl}`)
  checkErrs('counts')

  // 6. Round-trip: save and diff
  await q.setDialog({ save: '/mock/saved.md' })
  await page.keyboard.press('Meta+s')
  await page.waitForTimeout(500)
  const saved = await q.readFile('/mock/sample.md')
  const savedAs = await q.readFile('/mock/saved.md')
  const out = saved ?? savedAs
  findings.push(`save wrote to: ${saved ? 'original path' : savedAs ? 'dialog path (BUG: had a path already?)' : 'NOWHERE'}`)
  checkErrs('save')
  if (out) {
    const norm = (s: string) => s.replace(/\s+$/gm, '').trim()
    findings.push(`round-trip identical: ${norm(out) === norm(SAMPLE) ? 'yes' : 'NO'}`)
    if (norm(out) !== norm(SAMPLE)) {
      findings.push('--- saved content ---\n' + out + '\n--- end ---')
    }
  }

  // 7. Click below content focuses editor?
  await page.locator('#editor-container').click({ position: { x: 550, y: 700 } })
  const focusedInEditor = await page.evaluate(() =>
    document.activeElement?.closest('.tiptap') != null || document.activeElement?.classList.contains('tiptap'))
  findings.push(`click in empty area below content focuses editor: ${focusedInEditor ? 'yes' : 'NO'}`)
  checkErrs('click below')

  // 8. Dark mode screenshot
  await q.page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(SHOTS, 'audit-03-dark.png') })
  checkErrs('dark mode')

  // 9. Perf: large file open timing (in-browser, mock fs so pure parse+render cost)
  const big = ('## Section\n\nlorem ipsum dolor sit amet '.repeat(40) + '\n\n').repeat(120)
  const q2 = await launchQuill({ files: { '/mock/large.md': big } })
  const t0 = Date.now()
  await q2.page.goto('http://localhost:1420/?open=' + encodeURIComponent('/mock/large.md'))
  await q2.page.waitForFunction(() => (window as any).__QUILL_MOCK__?.windowVisible === true, undefined, { timeout: 30000 })
  findings.push(`large doc (${Math.round(big.length / 1024)}KB) open->window-visible: ${Date.now() - t0}ms`)
  await q2.close()

  findings.push(`console errors: ${q.consoleErrors.length ? q.consoleErrors.join(' | ') : 'none'}`)

  console.log('\n=== AUDIT FINDINGS ===')
  for (const f of findings) console.log('•', f)
  await q.close()
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
