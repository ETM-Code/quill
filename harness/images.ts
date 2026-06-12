// Image support checks: markdown round-trip (parse -> serialize), that an <img>
// actually renders, and that a simulated paste writes a file + inserts a node.
// Run: bun harness/images.ts
import { launchQuill } from './driver'

const ROUNDTRIP = [
  '![a cat](https://example.com/cat.png)',
  '![local relative](assets/img-ab12cd34.png)',
  '![](photo.jpg)',
  '![titled](pic.png "A title")',
  '![alt text](https://example.com/x.png)\n\nA paragraph after the image.',
]

async function main() {
  const q = await launchQuill({
    files: { '/mock/doc.md': '# title\n' },
    open: '/mock/doc.md',
  })
  const { page } = q
  const findings: string[] = []
  let failed = false

  // 1. Round-trip: setMarkdown then getMarkdown should be byte-stable.
  for (const md of ROUNDTRIP) {
    const out: string = await page.evaluate(m => {
      const d = (window as any).quillDebug
      d.setMarkdown(m)
      return d.getMarkdown()
    }, md)
    const ok = out.trim() === md.trim()
    if (!ok) failed = true
    findings.push(`${ok ? 'PASS' : 'FAIL'}  round-trip\n        in:  ${JSON.stringify(md)}\n        out: ${JSON.stringify(out.trim())}`)
  }

  // 2. An image node renders as a real <img> with a resolved src.
  await page.evaluate(() => (window as any).quillDebug.setMarkdown('![x](https://e.com/a.png)'))
  await page.waitForTimeout(100)
  const imgCount = await page.locator('.tiptap img.quill-image').count()
  const imgSrc = imgCount ? await page.locator('.tiptap img.quill-image').first().getAttribute('src') : null
  const okImg = imgCount === 1 && imgSrc === 'https://e.com/a.png'
  if (!okImg) failed = true
  findings.push(`${okImg ? 'PASS' : 'FAIL'}  renders <img> (count=${imgCount}, src=${imgSrc})`)

  // 3. Local relative src resolves against the doc dir via convertFileSrc
  //    (the mock returns the path as-is, so we expect the joined absolute path).
  await page.evaluate(() => (window as any).quillDebug.setMarkdown('![y](assets/p.png)'))
  await page.waitForTimeout(100)
  const localSrc = await page.locator('.tiptap img.quill-image').first().getAttribute('src')
  const okLocal = localSrc === '/mock/assets/p.png'
  if (!okLocal) failed = true
  findings.push(`${okLocal ? 'PASS' : 'FAIL'}  local src resolved to doc dir (got ${localSrc})`)

  // 4. Simulated paste: dispatch a paste event carrying a PNG file, then confirm
  //    a file was written under assets/ and an image node was inserted.
  await page.evaluate(() => (window as any).quillDebug.setMarkdown(''))
  await page.locator('.tiptap').click()
  await page.evaluate(() => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const file = new File([bytes], 'pasted.png', { type: 'image/png' })
    const dt = new DataTransfer()
    dt.items.add(file)
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
    document.querySelector('.tiptap')!.dispatchEvent(ev)
  })
  await page.waitForTimeout(400)
  const writtenPaths = await q.calls().then(cs =>
    cs.filter(c => c.cmd === 'write_image_file').map(c => (c.args as any).path))
  const insertedMd: string = await page.evaluate(() => (window as any).quillDebug.getMarkdown())
  const okPaste = writtenPaths.length === 1
    && /\/mock\/assets\/img-[0-9a-f]{8}\.png$/.test(writtenPaths[0])
    && /!\[\]\(assets\/img-[0-9a-f]{8}\.png\)/.test(insertedMd)
  if (!okPaste) failed = true
  findings.push(`${okPaste ? 'PASS' : 'FAIL'}  paste wrote ${JSON.stringify(writtenPaths)} and inserted ${JSON.stringify(insertedMd.trim())}`)

  console.log('\n=== IMAGE SUPPORT ===')
  for (const f of findings) console.log('•', f)
  // The dummy image URLs above can't load (DNS/404); those resource errors are
  // expected test noise, not app errors.
  const realErrors = q.consoleErrors.filter(e => !/Failed to load resource/i.test(e))
  console.log('console errors:', realErrors.length ? realErrors.join(' | ') : 'none')
  if (realErrors.length) failed = true

  await q.close()
  process.exit(failed ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
