// Harness driver: boots the vite dev server (if needed), launches a browser
// with the Tauri IPC mock injected, and exposes helpers for scenarios.
//
// Usage:  const q = await launchQuill({ files: {...}, open: '/doc.md' })
//         ... drive q.page ...
//         await q.close()
import { spawn, type ChildProcess } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { webkit, chromium, type Browser, type Page, type BrowserContext } from 'playwright'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEV_URL = 'http://localhost:1420'
const MOCK_SCRIPT = readFileSync(join(ROOT, 'harness', 'tauri-mock.js'), 'utf8')

let devServer: ChildProcess | null = null

async function serverUp(): Promise<boolean> {
  try {
    const res = await fetch(DEV_URL, { signal: AbortSignal.timeout(1000) })
    return res.ok
  } catch {
    return false
  }
}

export async function ensureDevServer(): Promise<void> {
  if (await serverUp()) return
  devServer = spawn('bun', ['run', 'dev'], { cwd: ROOT, stdio: 'ignore' })
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 250))
    if (await serverUp()) return
  }
  throw new Error('vite dev server failed to start on :1420')
}

export interface QuillOptions {
  /** Seed the mock filesystem: path -> content */
  files?: Record<string, string>
  /** Open this path on startup (via ?open= URL param, like file associations) */
  open?: string
  /** Dialog responses */
  dialog?: { save?: string | null; open?: string | null; ask?: boolean; confirm?: boolean }
  colorScheme?: 'light' | 'dark'
  engine?: 'webkit' | 'chromium'
  headless?: boolean
  /** Extra query params for the page URL */
  query?: Record<string, string>
}

export interface Quill {
  browser: Browser
  context: BrowserContext
  page: Page
  /** Read a file from the mock fs (what the app saved) */
  readFile(path: string): Promise<string | undefined>
  writeFile(path: string, content: string): Promise<void>
  setDialog(responses: NonNullable<QuillOptions['dialog']>): Promise<void>
  calls(): Promise<Array<{ cmd: string; args: unknown }>>
  openedUrls(): Promise<string[]>
  mockState(): Promise<{ windowVisible: boolean; windowTitle: string | null; documentEdited: boolean | null }>
  /** Markdown that would be saved right now */
  markdown(): Promise<string>
  /** Replace document content from a markdown string (through the app's own setter) */
  consoleErrors: string[]
  close(): Promise<void>
}

// One shared browser per engine; scenarios get isolated contexts. Launching
// many sequential WebKit instances in one process is flaky on macOS.
const sharedBrowsers = new Map<string, Browser>()

async function getBrowser(engine: 'webkit' | 'chromium', headless: boolean): Promise<Browser> {
  const key = `${engine}:${headless}`
  let browser = sharedBrowsers.get(key)
  if (!browser || !browser.isConnected()) {
    browser = await (engine === 'chromium' ? chromium : webkit).launch({ headless })
    sharedBrowsers.set(key, browser)
  }
  return browser
}

export async function launchQuill(opts: QuillOptions = {}): Promise<Quill> {
  await ensureDevServer()

  const browser = await getBrowser(opts.engine ?? 'webkit', opts.headless !== false)
  const context = await browser.newContext({
    colorScheme: opts.colorScheme ?? 'light',
    viewport: { width: 1100, height: 760 },
  })

  const seed = { files: opts.files ?? {}, dialog: opts.dialog ?? {} }
  await context.addInitScript(`window.__QUILL_MOCK_SEED__ = ${JSON.stringify(seed)};\n${MOCK_SCRIPT}`)

  const page = await context.newPage()
  const consoleErrors: string[] = []
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', err => consoleErrors.push(err.stack ? String(err.stack) : String(err)))

  const params = new URLSearchParams(opts.query ?? {})
  if (opts.open) params.set('open', opts.open)
  const qs = params.toString()
  await page.goto(qs ? `${DEV_URL}/?${qs}` : DEV_URL)
  // Wait for the editor to be mounted
  await page.waitForSelector('.tiptap', { timeout: 10000 })

  return {
    browser,
    context,
    page,
    consoleErrors,
    readFile: (path) =>
      page.evaluate(p => (window as any).__QUILL_MOCK__.files.get(p), path),
    writeFile: (path, content) =>
      page.evaluate(([p, c]) => { (window as any).__QUILL_MOCK__.files.set(p, c) }, [path, content] as const),
    setDialog: (responses) =>
      page.evaluate(r => { Object.assign((window as any).__QUILL_MOCK__.dialog, r) }, responses),
    calls: () =>
      page.evaluate(() => (window as any).__QUILL_MOCK__.calls),
    openedUrls: () =>
      page.evaluate(() => (window as any).__QUILL_MOCK__.openedUrls),
    mockState: () =>
      page.evaluate(() => {
        const m = (window as any).__QUILL_MOCK__
        return { windowVisible: m.windowVisible, windowTitle: m.windowTitle, documentEdited: m.documentEdited }
      }),
    markdown: () =>
      page.evaluate(() => (window as any).quillDebug?.getMarkdown?.() ?? '(quillDebug.getMarkdown not exposed)'),
    close: async () => {
      await context.close()
    },
  }
}

export function stopDevServer(): void {
  devServer?.kill()
}

/** Cmd on mac-style shortcuts (webkit maps Meta correctly) */
export async function press(page: Page, combo: string): Promise<void> {
  await page.keyboard.press(combo)
}
