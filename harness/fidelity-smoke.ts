// Quick browser smoke: load a doc, read back markdown, report console errors.
import { launchQuill, stopDevServer } from './gap-driver'
const md = '---\ntitle: x\n---\n\n# Hi <API_KEY>\n\nline one\nline two with $E=mc^2$\n\n> [!NOTE]\n> note\n\n- [ ] task\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```mermaid\ngraph TD\n  A-->B\n```\n\nfoot[^1]\n\n[^1]: note\n\n<details>\n<summary>S</summary>\n\nbody\n\n</details>\n'
const q = await launchQuill({ files: { '/m/a.md': md }, open: '/m/a.md' })
await q.page.waitForTimeout(1200)
const out = await q.markdown()
console.log('identical:', out === md)
if (out !== md) console.log(JSON.stringify(out))
await q.page.screenshot({ path: '.agent-logs/shots/fidelity-smoke.png', fullPage: true })
console.log('errors:', q.consoleErrors)
await q.close(); stopDevServer(); process.exit(0)
