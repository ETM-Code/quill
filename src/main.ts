import { Editor, Extension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import Placeholder from '@tiptap/extension-placeholder'
import Typography from '@tiptap/extension-typography'
import { Mathematics } from '@tiptap/extension-mathematics'
import { getMarkdownFromEditor, setMarkdownInEditor } from './editor-markdown'
import { getMarkdownPasteContent } from './markdown-paste'
import { openFirstWorkingStartupFile, selectStartupFiles } from './startup-files'

// State
let editor: Editor
let isModified = false
let currentFilename = 'untitled.md'
let currentFilePath: string | null = null
let codeHighlightingLoaded = false
let suppressEditorUpdateSideEffects = false
let dialogApiPromise: Promise<typeof import('@tauri-apps/plugin-dialog')> | null = null
let fsApiPromise: Promise<typeof import('@tauri-apps/plugin-fs')> | null = null
let coreApiPromise: Promise<typeof import('@tauri-apps/api/core')> | null = null
let windowApiPromise: Promise<typeof import('@tauri-apps/api/window')> | null = null
let eventApiPromise: Promise<typeof import('@tauri-apps/api/event')> | null = null
let mathMigrationModulePromise: Promise<typeof import('./math-migration')> | null = null
let katexCssPromise: Promise<unknown> | null = null

// DOM Elements
let filenameEl: HTMLElement
let modifiedIndicator: HTMLElement

// Shared KaTeX config
const katexMacros = {
  '\\R': '\\mathbb{R}',
  '\\N': '\\mathbb{N}',
  '\\Z': '\\mathbb{Z}',
  '\\Q': '\\mathbb{Q}',
  '\\C': '\\mathbb{C}',
}

// Build extensions with optional code highlighting
function buildExtensions(codeBlockLowlight?: any) {
  const extensions = [
    StarterKit.configure({
      codeBlock: codeBlockLowlight ? false : undefined,
    }),
    Markdown,
    Placeholder.configure({
      placeholder: 'Start writing...',
    }),
    Typography,
    Mathematics.configure({
      inlineOptions: {
        onClick: (node: any, pos: number) => {
          const latex = prompt('Edit LaTeX:', node.attrs.latex)
          if (latex !== null && latex !== '') {
            editor.chain().setNodeSelection(pos).updateInlineMath({ latex }).focus().run()
          }
        },
      },
      blockOptions: {
        onClick: (node: any, pos: number) => {
          const latex = prompt('Edit LaTeX:', node.attrs.latex)
          if (latex !== null && latex !== '') {
            editor.chain().setNodeSelection(pos).updateBlockMath({ latex }).focus().run()
          }
        },
      },
      katexOptions: {
        throwOnError: false,
        macros: katexMacros,
      },
    }),
    CodeBlockTrigger,
    KatexCssTrigger,
  ]

  if (codeBlockLowlight) {
    extensions.splice(1, 0, codeBlockLowlight)
  }

  return extensions
}

// Debounce utility
function debounce<T extends (...args: any[]) => unknown>(fn: T, ms: number): T {
  let timeoutId: ReturnType<typeof setTimeout>
  return ((...args: any[]) => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn(...args), ms)
  }) as T
}

function containsDollarSign(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.includes('$')
  }

  if (Array.isArray(value)) {
    return value.some(containsDollarSign)
  }

  if (value && typeof value === 'object') {
    return Object.values(value).some(containsDollarSign)
  }

  return false
}

function shouldRunMathMigrationForTransaction(transaction: any): boolean {
  if (!transaction?.docChanged) {
    return false
  }

  const steps = transaction.steps ?? []
  if (steps.length === 0) {
    return false
  }

  return steps.some((step: any) => {
    if (!step || typeof step.toJSON !== 'function') {
      return false
    }
    return containsDollarSign(step.toJSON())
  })
}

function getMathMigrationModule() {
  if (!mathMigrationModulePromise) {
    mathMigrationModulePromise = import('./math-migration')
  }
  return mathMigrationModulePromise
}

function loadKatexCss(): Promise<unknown> {
  if (!katexCssPromise) {
    katexCssPromise = import('katex/dist/katex.min.css')
  }
  return katexCssPromise
}

async function migrateAllMathInEditor(targetEditor: Editor): Promise<void> {
  const { migrateAllMathStrings } = await getMathMigrationModule()
  migrateAllMathStrings(targetEditor)
}

// Migrate math strings (debounced to avoid running on every keystroke)
const debouncedMigrateMath = debounce(() => {
  if (editor) {
    void migrateAllMathInEditor(editor)
  }
}, 300)

// Initialize editor
function createEditor(content: any = '') {
  editor = new Editor({
    element: document.getElementById('editor')!,
    extensions: buildExtensions(),
    content,
    autofocus: true,
    editorProps: {
      attributes: {
        class: 'tiptap',
      },
      handlePaste: (_view, event) => {
        if (editor.state.selection.$from.parent.type.spec.code) {
          return false
        }

        const markdown = getMarkdownPasteContent(event)
        if (!markdown) {
          return false
        }

        return editor.commands.insertContent(markdown, { contentType: 'markdown' })
      },
    },
    onCreate: ({ editor: currentEditor }) => {
      // Avoid math migration work for empty/non-math startup docs.
      if (currentEditor.getText().includes('$')) {
        void loadKatexCss()
        void migrateAllMathInEditor(currentEditor)
      }
    },
    onUpdate: ({ transaction }) => {
      if (suppressEditorUpdateSideEffects) {
        return
      }
      // Guard to avoid redundant DOM updates
      if (!isModified) {
        setModified(true)
      }
      // Only run expensive math migration when this update introduced math syntax.
      if (shouldRunMathMigrationForTransaction(transaction as any)) {
        debouncedMigrateMath()
      }
    },
  })

  return editor
}

// Extension to detect code blocks and lazy-load highlighting
const CodeBlockTrigger = Extension.create({
  name: 'codeBlockTrigger',

  addKeyboardShortcuts() {
    return {
      // Detect ``` for code blocks
      '`': () => {
        const { state } = this.editor
        const { from } = state.selection
        const textBefore = state.doc.textBetween(Math.max(0, from - 2), from)

        if (textBefore === '``' && !codeHighlightingLoaded) {
          loadCodeHighlighting()
        }
        return false
      },
    }
  },
})

const KatexCssTrigger = Extension.create({
  name: 'katexCssTrigger',

  addKeyboardShortcuts() {
    return {
      '$': () => {
        void loadKatexCss()
        return false
      },
    }
  },
})

// Lazy load code highlighting
async function loadCodeHighlighting(): Promise<void> {
  if (codeHighlightingLoaded) return
  codeHighlightingLoaded = true

  try {
    // Load imports first
    const [{ CodeBlockLowlight }, { common, createLowlight }] = await Promise.all([
      import('@tiptap/extension-code-block-lowlight'),
      import('lowlight'),
    ])

    const lowlight = createLowlight(common)

    // Capture content AFTER imports complete to avoid losing edits during await
    const snapshot = editor.getJSON()
    const { from } = editor.state.selection

    editor.destroy()

    const codeBlockExt = CodeBlockLowlight.configure({
      lowlight,
      defaultLanguage: 'plaintext',
    })

    editor = new Editor({
      element: document.getElementById('editor')!,
      extensions: buildExtensions(codeBlockExt),
      content: snapshot, // Use JSON to preserve structure
      autofocus: true,
      editorProps: {
        attributes: {
          class: 'tiptap',
        },
      },
      onCreate: ({ editor: currentEditor }) => {
        if (currentEditor.getText().includes('$')) {
          void loadKatexCss()
          void migrateAllMathInEditor(currentEditor)
        }
      },
      onUpdate: ({ transaction }) => {
        if (suppressEditorUpdateSideEffects) {
          return
        }
        if (!isModified) {
          setModified(true)
        }
        if (shouldRunMathMigrationForTransaction(transaction as any)) {
          debouncedMigrateMath()
        }
      },
    })

    // Try to restore cursor position
    try {
      editor.commands.focus()
      editor.commands.setTextSelection(Math.min(from, editor.state.doc.content.size))
    } catch {
      // Ignore cursor restore errors
    }

    console.log('Code highlighting loaded')
  } catch (e) {
    console.error('Failed to load code highlighting:', e)
    codeHighlightingLoaded = false
  }
}

// Check if content has code blocks and load highlighting if needed
async function ensureCodeHighlightingForContent(content: string): Promise<void> {
  if (!codeHighlightingLoaded && content.includes('```')) {
    await loadCodeHighlighting()
  }
}

async function ensureKatexCssForContent(content: string): Promise<void> {
  if (content.includes('$')) {
    await loadKatexCss()
  }
}

// UI State
function setModified(modified: boolean) {
  isModified = modified
  modifiedIndicator.classList.toggle('hidden', !modified)
}

function setFilename(name: string) {
  currentFilename = name
  filenameEl.textContent = name
  document.title = `${name} - Quill`
}

function nowMs(): number {
  return performance.now()
}

function logPerf(label: string, startMs: number): void {
  if (import.meta.env.DEV) {
    console.log(`[perf] ${label}: ${(nowMs() - startMs).toFixed(1)}ms`)
  }
}

function debugLog(...args: any[]): void {
  if (import.meta.env.DEV) {
    console.log(...args)
  }
}

function getDialogApi() {
  if (!dialogApiPromise) {
    dialogApiPromise = import('@tauri-apps/plugin-dialog')
  }
  return dialogApiPromise
}

function getFsApi() {
  if (!fsApiPromise) {
    fsApiPromise = import('@tauri-apps/plugin-fs')
  }
  return fsApiPromise
}

function getCoreApi() {
  if (!coreApiPromise) {
    coreApiPromise = import('@tauri-apps/api/core')
  }
  return coreApiPromise
}

function getWindowApi() {
  if (!windowApiPromise) {
    windowApiPromise = import('@tauri-apps/api/window')
  }
  return windowApiPromise
}

function getEventApi() {
  if (!eventApiPromise) {
    eventApiPromise = import('@tauri-apps/api/event')
  }
  return eventApiPromise
}

async function showCurrentWindow(): Promise<void> {
  // Browser/non-Tauri contexts should skip window API loading entirely.
  if (!(window as any).__TAURI_INTERNALS__) {
    return
  }

  try {
    const { getCurrentWindow } = await getWindowApi()
    await getCurrentWindow().show()
  } catch (e) {
    console.error('Failed to show window:', e)
  }
}

function setupTitlebarDragging() {
  const titlebarEl = document.getElementById('titlebar')
  if (!titlebarEl || !(window as any).__TAURI_INTERNALS__) {
    return
  }

  titlebarEl.addEventListener('mousedown', async (event) => {
    // Only start drag on primary-button press in explicit drag regions.
    if (event.button !== 0) {
      return
    }

    const target = event.target as HTMLElement | null
    const dragRegion = target?.closest('[data-tauri-drag-region]')
    if (!dragRegion) {
      return
    }

    try {
      const { getCurrentWindow } = await getWindowApi()
      await getCurrentWindow().startDragging()
    } catch (e) {
      console.error('Failed to start window drag:', e)
    }
  })
}

function setupMenuEventListeners() {
  if (!(window as any).__TAURI_INTERNALS__) {
    return
  }

  void (async () => {
    try {
      const { listen } = await getEventApi()
      await listen('quill://menu-new', () => {
        if (!document.hasFocus()) return
        void newFile()
      })
      await listen('quill://menu-open', () => {
        if (!document.hasFocus()) return
        void openFile()
      })
      await listen('quill://menu-save', () => {
        if (!document.hasFocus()) return
        void saveFile()
      })
      await listen<string>('quill://menu-open-path', (event) => {
        if (!document.hasFocus()) return
        const filePath = event.payload?.trim()
        if (filePath) {
          void openFilePath(filePath)
        }
      })
    } catch (e) {
      console.error('Failed to set up menu event listeners:', e)
    }
  })()
}

async function trackRecentFile(filePath: string): Promise<void> {
  if (!(window as any).__TAURI_INTERNALS__) {
    return
  }

  try {
    const { invoke } = await getCoreApi()
    await invoke('track_recent_file', { path: filePath })
  } catch (e) {
    console.warn('Failed to track recent file:', e)
  }
}

// Extract filename from path (cross-platform)
function getBasename(filePath: string): string {
  // Handle both Unix and Windows paths
  const parts = filePath.split(/[/\\]/)
  return parts[parts.length - 1] || 'untitled.md'
}

// Confirm discarding unsaved changes
async function confirmDiscardChanges(): Promise<boolean> {
  if (!isModified) return true

  try {
    const { ask } = await getDialogApi()
    return await ask('You have unsaved changes. Discard them?', {
      title: 'Unsaved Changes',
      kind: 'warning',
    })
  } catch {
    // Fallback to browser confirm if Tauri dialog fails
    return window.confirm('You have unsaved changes. Discard them?')
  }
}

// Keyboard shortcuts
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', async (e) => {
    const isMod = e.metaKey || e.ctrlKey

    // Cmd+S - Save
    if (isMod && e.key === 's') {
      e.preventDefault()
      await saveFile()
    }

    // Cmd+O - Open
    if (isMod && e.key === 'o') {
      e.preventDefault()
      await openFile()
    }

    // Cmd+N - New
    if (isMod && e.key === 'n') {
      e.preventDefault()
      await newFile()
    }
  })
}

// Get markdown content from editor
function getMarkdownContent(): string {
  return getMarkdownFromEditor(editor as any)
}

// Set markdown content in editor
function setMarkdownContent(markdown: string): void {
  setMarkdownInEditor(editor as any, markdown)
}

function applyExternalMarkdownContent(markdown: string): void {
  suppressEditorUpdateSideEffects = true
  try {
    setMarkdownContent(markdown)
    if (markdown.includes('$')) {
      void loadKatexCss()
      void migrateAllMathInEditor(editor)
    }
  } finally {
    suppressEditorUpdateSideEffects = false
  }
}

// File operations (Tauri)
async function saveFile() {
  try {
    const { save } = await getDialogApi()
    const { writeTextFile } = await getFsApi()

    const markdown = getMarkdownContent()

    // If we already have a file path, save directly
    const targetPath = currentFilePath ?? await save({
      defaultPath: currentFilename,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })

    if (targetPath) {
      await writeTextFile(targetPath, markdown)
      currentFilePath = targetPath
      setFilename(getBasename(targetPath))
      setModified(false)
      await trackRecentFile(targetPath)
    }
  } catch (e) {
    console.error('Save failed:', e)
  }
}

async function openFile() {
  // Confirm before discarding unsaved changes
  if (!await confirmDiscardChanges()) return

  try {
    const { open } = await getDialogApi()

    const filePath = await open({
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
    })

    if (filePath && typeof filePath === 'string') {
      await openFilePath(filePath)
    }
  } catch (e) {
    console.error('Open failed:', e)
  }
}

async function newFile() {
  // Confirm before discarding unsaved changes
  if (!await confirmDiscardChanges()) return

  editor.commands.clearContent()
  currentFilePath = null
  setFilename('untitled.md')
  setModified(false)
}

// Open a file by path (used by file associations)
async function openFilePath(filePath: string): Promise<boolean> {
  const tOpenStart = nowMs()
  try {
    // Test hook for browser smoke tests (non-Tauri runtime).
    const testContent = window.__QUILL_TEST_FILE_CONTENTS__?.[filePath]
    if (typeof testContent === 'string') {
      await ensureCodeHighlightingForContent(testContent)
      applyExternalMarkdownContent(testContent)
      currentFilePath = filePath
      setFilename(getBasename(filePath))
      setModified(false)
      return true
    }

    const tReadStart = nowMs()
    let content: string
    try {
      const { readTextFile } = await getFsApi()
      content = await readTextFile(filePath)
    } catch (pluginReadError) {
      const { invoke } = await getCoreApi()
      content = await invoke<string>('read_markdown_file', { path: filePath })
      console.warn('Fell back to native file read for:', filePath, pluginReadError)
    }
    logPerf(`openFilePath read (${getBasename(filePath)})`, tReadStart)

    // Load code highlighting if needed
    const tCodeStart = nowMs()
    await ensureCodeHighlightingForContent(content)
    logPerf(`openFilePath code-highlight check (${getBasename(filePath)})`, tCodeStart)

    const tKatexStart = nowMs()
    await ensureKatexCssForContent(content)
    logPerf(`openFilePath katex-css check (${getBasename(filePath)})`, tKatexStart)

    // Set content
    const tSetContentStart = nowMs()
    applyExternalMarkdownContent(content)
    logPerf(`openFilePath set content (${getBasename(filePath)})`, tSetContentStart)

    currentFilePath = filePath
    setFilename(getBasename(filePath))
    setModified(false)
    await trackRecentFile(filePath)
    logPerf(`openFilePath total (${getBasename(filePath)})`, tOpenStart)
    return true
  } catch (e) {
    console.error('Failed to open file:', e)
    logPerf(`openFilePath failed (${getBasename(filePath)})`, tOpenStart)
    return false
  }
}

// Declare global for TypeScript
declare global {
  interface Window {
    openedFiles?: string[]
    __QUILL_TEST_FILE_CONTENTS__?: Record<string, string>
    __QUILL_STARTUP_DONE__?: boolean
    __QUILL_STARTUP_DONE_MS__?: number
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  const tStartupStart = nowMs()
  debugLog('DOMContentLoaded fired')
  debugLog('window.openedFiles =', window.openedFiles)
  const parsedUrl = new URL(window.location.href)
  const startupFileFromUrl = parsedUrl.searchParams.get('open')
  const isKeepaliveWindow = parsedUrl.searchParams.get('keepalive') === '1'

  if (isKeepaliveWindow) {
    if (import.meta.env.DEV) {
      console.log('[perf] keepalive window booted')
    }
    return
  }

  // Initialize DOM element references
  filenameEl = document.getElementById('filename')!
  modifiedIndicator = document.getElementById('modified-indicator')!

  const tCreateEditorStart = nowMs()
  createEditor()
  logPerf('createEditor', tCreateEditorStart)
  setupKeyboardShortcuts()
  setupMenuEventListeners()
  setupTitlebarDragging()
  setFilename('untitled.md')

  const startupFiles = selectStartupFiles(
    window.openedFiles,
    startupFileFromUrl ? [startupFileFromUrl] : [],
  )

  if (startupFiles.length > 0) {
    try {
      const openedFile = await openFirstWorkingStartupFile(
        startupFiles,
        openFilePath,
        (filePath) => debugLog('Opening startup file:', filePath),
      )
      if (openedFile) {
        debugLog('Startup file opened successfully:', openedFile)
      } else {
        console.warn('No startup files could be opened')
      }
    } catch (e) {
      console.error('Failed while processing startup files:', e)
    }
  } else {
    debugLog('No files to open on startup')
  }

  void showCurrentWindow()
  logPerf('startup total', tStartupStart)
  window.__QUILL_STARTUP_DONE__ = true
  window.__QUILL_STARTUP_DONE_MS__ = nowMs() - tStartupStart
})
