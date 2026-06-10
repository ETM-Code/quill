// Screenshot showcase for visual review: rich document, light + dark, UI states.
import { launchQuill } from './driver'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const SHOTS = join(import.meta.dir, 'shots')
mkdirSync(SHOTS, { recursive: true })

const DOC = `# Planning the Aurora release

The launch checklist below tracks everything left before we ship. See the
[release notes draft](https://example.com/aurora) for the public-facing story.

## Status

| Workstream | Owner | State |
|---|---|---|
| Sync engine | Maya | **done** |
| Offline cache | Tom | in review |
| Billing | Priya | ~~blocked~~ started |

- [x] Cut release branch
- [x] Run load tests
- [ ] Update onboarding docs
- [ ] Record demo video

## Notes from the sync meeting

> Ship the smallest thing that proves the loop works end to end.
> Everything else is polish.

The retry backoff is computed as $t_n = t_0 \\cdot 2^n + \\epsilon$ where the
jitter term keeps thundering herds away:

$$
\\epsilon \\sim \\mathcal{U}(0,\\ t_0)
$$

\`\`\`typescript
async function retry<T>(fn: () => Promise<T>, base = 250): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt >= 5) throw err
      await sleep(base * 2 ** attempt + Math.random() * base)
    }
  }
}
\`\`\`

A divider, then a closing thought.

---

Inline \`code\`, **bold**, *italics*, and a [link](https://tauri.app) all in one line.
`

async function main() {
  for (const scheme of ['light', 'dark'] as const) {
    const q = await launchQuill({ files: { '/m/showcase.md': DOC }, open: '/m/showcase.md', colorScheme: scheme })
    await q.page.waitForTimeout(1200)
    await q.page.screenshot({ path: join(SHOTS, `showcase-${scheme}.png`), fullPage: false })
    {
      // selection + bubble menu state
      await q.page.locator('.tiptap h2').first().selectText()
      await q.page.waitForTimeout(400)
      await q.page.screenshot({ path: join(SHOTS, `showcase-bubble-${scheme}.png`) })
      // slash menu state
      await q.page.keyboard.press('Meta+ArrowDown')
      await q.page.keyboard.press('Enter')
      await q.page.keyboard.type('/')
      await q.page.waitForTimeout(400)
      await q.page.screenshot({ path: join(SHOTS, `showcase-slash-${scheme}.png`) })
      await q.page.keyboard.press('Escape')
      // find bar state
      await q.page.keyboard.press('Meta+Alt+f')
      await q.page.locator('.find-bar-input').first().fill('the')
      await q.page.waitForTimeout(500)
      await q.page.screenshot({ path: join(SHOTS, `showcase-find-${scheme}.png`) })
    }
    await q.close()
  }
  console.log('showcase shots written')
  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
