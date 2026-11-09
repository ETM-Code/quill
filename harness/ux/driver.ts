// Shared helpers for the harness/ux-*.ts scenarios.
import { readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launchQuill, type Quill, type QuillOptions } from '../gap-driver'

export const ROOT = join(import.meta.dir, '..', '..')
export const SHOTS = join(ROOT, 'harness', 'shots')
mkdirSync(SHOTS, { recursive: true })
const EXT = readFileSync(join(import.meta.dir, 'mock-ext.js'), 'utf8')

export interface Result { name: string; ok: boolean; detail: string }

export class Suite {
  results: Result[] = []
  constructor(public suite: string) {}
  check(name: string, ok: boolean, detail: unknown = ''): void {
    const d = typeof detail === 'string' ? detail : JSON.stringify(detail)
    this.results.push({ name: `${this.suite}: ${name}`, ok, detail: d })
    console.log(`${ok ? 'PASS' : 'FAIL'} ${this.suite}: ${name}${d ? `  — ${d.slice(0, 300)}` : ''}`)
  }
  async step(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn() } catch (e: any) { this.check(name, false, `threw: ${e?.stack ?? e}`) }
  }
}

/** launchQuill + the UX mock extension. Default doc at /mock/doc/a.md. */
export async function launchUx(opts: QuillOptions & { md?: string } = {}): Promise<Quill> {
  const files = opts.files ?? { '/mock/doc/a.md': opts.md ?? '' }
  const q = await launchQuill({ ...opts, files, open: opts.open === undefined ? '/mock/doc/a.md' : opts.open || undefined })
  // The init script order matters: the extension must run after tauri-mock.js.
  // gap-driver injects the mock via addInitScript; re-inject ours and reload.
  await q.context.addInitScript(EXT)
  await q.page.reload()
  await q.page.waitForSelector('.tiptap')
  await q.page.waitForFunction(() => !!(window as any).quillDebug?.ux, null, { timeout: 10000 })
  await q.page.waitForTimeout(250)
  return q
}

export const md = (q: Quill): Promise<string> => q.markdown()
export const setMd = (q: Quill, m: string) => q.page.evaluate((m: string) => (window as any).quillDebug.setMarkdown(m), m)
export const uxCalls = (q: Quill): Promise<Array<{ cmd: string; args: any }>> =>
  q.page.evaluate(() => (window as any).__QUILL_MOCK__.uxCalls)
export const ed = <T>(q: Quill, fn: (editor: any, arg: any) => T, arg?: unknown): Promise<T> =>
  q.page.evaluate(([f, a]: any) => (new Function('editor', 'arg', 'return (' + f + ')(editor, arg)'))((window as any).quillDebug.editor, a), [fn.toString(), arg] as const)
export const shot = (q: Quill, name: string) => q.page.screenshot({ path: join(SHOTS, `${name}.png`) })

/** Run `fn` against a light and a dark instance (for screenshots). */
export async function bothSchemes(opts: Parameters<typeof launchUx>[0], fn: (q: Quill, scheme: 'light' | 'dark') => Promise<void>): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    const q = await launchUx({ ...opts, colorScheme: scheme })
    try { await fn(q, scheme) } finally { await q.close() }
  }
}
