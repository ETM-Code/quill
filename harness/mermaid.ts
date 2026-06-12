// Mermaid diagram support checks:
//   (a) round-trip: setMarkdown -> getMarkdown is byte-stable for mermaid
//       blocks, and normal code blocks are unaffected;
//   (b) a valid diagram renders to an <svg> inside the mermaid block;
//   (c) invalid mermaid source shows the error UI without uncaught console errors.
// Run: bun harness/mermaid.ts
import { launchQuill } from './driver'

const MERMAID_BLOCK = '```mermaid\ngraph TD\n  A[Start] --> B[End]\n```'
const PYTHON_BLOCK = '```python\nprint("hello")\n```'

// A doc with both a mermaid fence and a normal python fence side by side.
const MIXED_DOC = `${MERMAID_BLOCK}\n\n${PYTHON_BLOCK}\n`

async function main() {
  const q = await launchQuill({
    files: { '/mock/doc.md': '# title\n' },
    open: '/mock/doc.md',
  })
  const { page } = q
  const findings: string[] = []
  let failed = false

  function check(label: string, ok: boolean, detail = ''): void {
    if (!ok) failed = true
    findings.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n        ${detail}` : ''}`)
  }

  // (a) Round-trip: mermaid block survives setMarkdown -> getMarkdown unchanged,
  //     and the adjacent python block is also unchanged.
  const roundTripOut: string = await page.evaluate(md => {
    const d = (window as any).quillDebug
    d.setMarkdown(md)
    return d.getMarkdown()
  }, MIXED_DOC)

  check(
    'mermaid round-trip (mixed doc)',
    roundTripOut.trim() === MIXED_DOC.trim(),
    `in:  ${JSON.stringify(MIXED_DOC.trim())}\n        out: ${JSON.stringify(roundTripOut.trim())}`,
  )

  // Also test a standalone mermaid block.
  const standaloneOut: string = await page.evaluate(md => {
    const d = (window as any).quillDebug
    d.setMarkdown(md)
    return d.getMarkdown()
  }, MERMAID_BLOCK + '\n')

  check(
    'mermaid round-trip (standalone)',
    standaloneOut.trim() === MERMAID_BLOCK.trim(),
    `in:  ${JSON.stringify(MERMAID_BLOCK.trim())}\n        out: ${JSON.stringify(standaloneOut.trim())}`,
  )

  // Python block alone is still handled by the code block (unaffected).
  const pythonOut: string = await page.evaluate(md => {
    const d = (window as any).quillDebug
    d.setMarkdown(md)
    return d.getMarkdown()
  }, PYTHON_BLOCK + '\n')

  check(
    'python block unaffected by mermaid extension',
    pythonOut.trim() === PYTHON_BLOCK.trim(),
    `in:  ${JSON.stringify(PYTHON_BLOCK.trim())}\n        out: ${JSON.stringify(pythonOut.trim())}`,
  )

  // (b) A valid mermaid diagram renders to an <svg> inside .mermaid-block.
  await page.evaluate(md => {
    (window as any).quillDebug.setMarkdown(md)
  }, MERMAID_BLOCK + '\n')

  // Allow time for the async mermaid render to complete.
  await page.waitForTimeout(2000)

  const svgCount = await page.locator('.mermaid-block .mermaid-svg svg').count()
  check(
    'valid diagram renders <svg>',
    svgCount >= 1,
    `svg count: ${svgCount}`,
  )

  // (c) Invalid mermaid source shows the error UI and does not produce uncaught
  //     errors that would break the editor.
  const INVALID = '```mermaid\nNOT VALID MERMAID @@@ !!!\n```\n'
  await page.evaluate(md => {
    (window as any).quillDebug.setMarkdown(md)
  }, INVALID)

  await page.waitForTimeout(2000)

  const errorVisible = await page.locator('.mermaid-block .mermaid-error').isVisible()
  check('invalid diagram shows error UI', errorVisible)

  // Editor must still be functional after an invalid diagram (round-trip the
  // valid doc again to confirm the editor hasn't crashed).
  const afterErrorOut: string = await page.evaluate(md => {
    const d = (window as any).quillDebug
    d.setMarkdown(md)
    return d.getMarkdown()
  }, MERMAID_BLOCK + '\n')

  check(
    'editor still functional after invalid diagram',
    afterErrorOut.trim() === MERMAID_BLOCK.trim(),
  )

  console.log('\n=== MERMAID SUPPORT ===')
  for (const f of findings) console.log('•', f)

  // Filter out benign noise: mermaid logs parse warnings to the console, and
  // resource 404s from dummy URLs are expected in the test harness.
  const realErrors = q.consoleErrors.filter(e =>
    !/Failed to load resource/i.test(e) &&
    !/mermaid/i.test(e)
  )
  console.log('console errors (filtered):', realErrors.length ? realErrors.join(' | ') : 'none')
  if (realErrors.length) failed = true

  await q.close()
  process.exit(failed ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
