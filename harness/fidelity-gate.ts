// Markdown fidelity gate. Exits non-zero on any failure.
//
// 1. Headless codec (fidelity-headless.ts): the 107-case audit corpus, the
//    extra cases in fidelity-cases.ts and the real-world files
//    (fixtures/realworld-files.txt), each in two modes:
//      preserve - open then save: must be byte-identical to the input;
//      fresh    - serializer alone (every block treated as edited): same
//                 meaning under the markdown-it oracle, modulo the
//                 normalisations listed in fidelity-lib.ts, and a second
//                 load -> save must be byte-identical to the first.
//    Constructs the oracle can't judge (footnotes, front matter, alerts,
//    math, details...) have exact expected outputs (fidelity-lib.ts EXACT).
// 2. The same corpus through the real app in WebKit (quillDebug.setMarkdown /
//    getMarkdown), which must match the headless results exactly.
// 3. Browser scenarios (fidelity-interact.ts): C20 undo across files, C26
//    external changes, CRLF, clipboard in/out, copy button fallback, typing.
//
// Usage: bun harness/fidelity-gate.ts [--skip-browser]
import { readFileSync, existsSync } from 'node:fs'
import { CASES } from './gap-audit-cases'
import { EXTRA_CASES } from './fidelity-cases'
import { EXACT } from './fidelity-lib'
import { realWorldFiles, runHeadless } from './fidelity-headless'
import { runInteract } from './fidelity-interact'
import { launchQuill, stopDevServer } from './gap-driver'

let failed = 0

console.log('== 1. headless codec')
const files = realWorldFiles()
const head = runHeadless(files)
for (const f of head.failures) console.log(`FAIL [${f.mode}] ${f.id}\n      ${f.detail}`)
console.log(`headless: ${head.checked} inputs (${CASES.length} corpus + ${EXTRA_CASES.length} extra + ${EXACT.length} exact + ${files.filter(existsSync).length} real files), ${head.failures.length} failures`)
failed += head.failures.length

if (!process.argv.includes('--skip-browser')) {
  console.log('\n== 2. app path in WebKit')
  const { getCodec } = await import('../src/markdown')
  const { quillSchema } = await import('../src/editor-setup')
  const codec = getCodec(quillSchema())
  const inputs: Array<[string, string]> = [
    ...CASES, ...EXTRA_CASES, ...EXACT.map(([id, md]) => [id, md] as [string, string]),
    ...files.filter(existsSync).map(f => [f.replace('/Users/eoghancollins/', '~/'), readFileSync(f, 'utf8')] as [string, string]),
  ]
  const q = await launchQuill({ files: { '/m/a.md': '' }, open: '/m/a.md' })
  await q.page.waitForTimeout(500)
  let browserFails = 0
  for (const [id, md] of inputs) {
    const r = await q.page.evaluate((m: string) => {
      const d = (window as any).quillDebug
      d.setMarkdown(m)
      const saved = d.getMarkdown()
      const fresh = (window as any).quillMarkdown.serializeFresh(m)
      return { saved, fresh }
    }, md)
    const want = md.replace(/\r\n?/g, '\n')
    const headlessFresh = codec.serialize(codec.parse(md).doc, { preserve: false })
    if (r.saved !== want) { browserFails++; console.log(`FAIL [app-save] ${id}: not byte-identical`) }
    if (r.fresh !== headlessFresh) { browserFails++; console.log(`FAIL [app-fresh] ${id}: browser and headless serializer differ`) }
  }
  // Corpus images point at files that don't exist in the mock fs (404s).
  const errors = q.consoleErrors.filter(e => !/favicon|Failed to load resource/.test(e))
  if (errors.length) { browserFails++; console.log('FAIL console errors:', errors.slice(0, 5)) }
  await q.close()
  console.log(`app path: ${inputs.length} inputs, ${browserFails} failures`)
  failed += browserFails

  console.log('\n== 3. browser scenarios')
  const res = await runInteract(s => console.log(s))
  console.log(`scenarios: ${res.pass} passed, ${res.fail} failed`)
  failed += res.fail
  stopDevServer()
}

console.log(failed ? `\nGATE FAILED: ${failed} failure(s)` : '\nGATE PASSED')
process.exit(failed ? 1 : 0)
