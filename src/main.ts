import { Editor, Extension } from '@tiptap/core'
import { DOMSerializer } from '@tiptap/pm/model'
import { getMarkdownFromEditor, setMarkdownInEditor } from './editor-markdown'
import { buildExtensions as buildEditorExtensions } from './editor-extensions'
import { applyMathEdit, getEditorMenuMode, shouldLazyLoadEditorMenus } from './editor-ui'
import { getFindShortcutMode, shouldCloseFindBarFromDocumentClick } from './find-bar'
import {
  buildImageAssetFilename,
  getImageAssetDirectory,
  getImageMarkdownPath,
} from './image-file-storage'
import { applyImageInsert } from './image-support'
import { getShortcutAction } from './keyboard-shortcuts'
import { getMarkdownPasteContent } from './markdown-paste'
import { getPlatformClassName, resolveAppPlatform, type AppPlatform } from './platform'
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
let pathApiPromise: Promise<typeof import('@tauri-apps/api/path')> | null = null
let windowApiPromise: Promise<typeof import('@tauri-apps/api/window')> | null = null
let eventApiPromise: Promise<typeof import('@tauri-apps/api/event')> | null = null
let mathMigrationModulePromise: Promise<typeof import('./math-migration')> | null = null
let katexCssPromise: Promise<unknown> | null = null
let lastFindQuery = ''
let codeBlockLowlightExtension: any | null = null
let uiMenuExtensions: {
  bubbleMenu: Extension
  floatingMenu: Extension
} | null = null
let uiMenusLoadPromise: Promise<void> | null = null
let bubbleMenuEl: HTMLElement | null = null
let floatingMenuEl: HTMLElement | null = null
let insertMenuOpen = false
let floatingMenuMode: 'hidden' | 'insert' | 'table' = 'hidden'
let findBarEl: HTMLElement | null = null
let findInputEl: HTMLInputElement | null = null
let appPlatform: AppPlatform = 'unknown'

// DOM Elements
let filenameEl: HTMLElement
let modifiedIndicator: HTMLElement

// Build extensions with optional lazy-loaded extensions
function buildExtensions() {
  return buildEditorExtensions({
    codeBlockLowlightExtension,
    uiMenuExtensions,
    onInlineMathClick: (node: any, pos: number) => {
      const latex = prompt('Edit LaTeX:', node.attrs.latex)
      applyMathEdit(
        {
          updateInlineMath: ({ latex, pos }) => editor.commands.updateInlineMath({ latex, pos }),
          updateBlockMath: ({ latex, pos }) => editor.commands.updateBlockMath({ latex, pos }),
        },
        'inline',
        latex,
        pos,
      )
    },
    onBlockMathClick: (node: any, pos: number) => {
      const latex = prompt('Edit LaTeX:', node.attrs.latex)
      applyMathEdit(
        {
          updateInlineMath: ({ latex, pos }) => editor.commands.updateInlineMath({ latex, pos }),
          updateBlockMath: ({ latex, pos }) => editor.commands.updateBlockMath({ latex, pos }),
        },
        'block',
        latex,
        pos,
      )
    },
    extraExtensions: [CodeBlockTrigger, KatexCssTrigger],
  })
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

type ClipboardPayload = {
  markdown: string
  html: string
}

function asTopLevelMarkdownContent(state: Editor['state'], content: any[]): any[] {
  if (content.length === 0) {
    return content
  }

  const hasBlockNode = content.some((node) => {
    const nodeTypeName = typeof node?.type === 'string' ? node.type : ''
    return Boolean(state.schema.nodes[nodeTypeName]?.isBlock)
  })

  if (hasBlockNode) {
    return content
  }

  return [
    {
      type: 'paragraph',
      content,
    },
  ]
}

function getSelectionClipboardPayload(currentEditor: Editor): ClipboardPayload | null {
  const { state } = currentEditor
  const { from, to, empty } = state.selection

  if (empty || from === to) {
    return null
  }

  const fragment = state.doc.slice(from, to).content
  const markdownManager = (currentEditor as any).markdown
  let markdown = ''

  if (typeof markdownManager?.serialize === 'function') {
    try {
      const selectionJson = fragment.toJSON()
      const topLevelContent = Array.isArray(selectionJson) ? selectionJson : [selectionJson]
      markdown = markdownManager.serialize({
        type: 'doc',
        content: asTopLevelMarkdownContent(state, topLevelContent),
      })
    } catch {
      markdown = ''
    }
  }

  if (!markdown.trim()) {
    markdown = state.doc.textBetween(from, to, '\n\n')
  }

  if (!markdown.trim()) {
    return null
  }

  const serializer = DOMSerializer.fromSchema(state.schema)
  const container = document.createElement('div')
  container.appendChild(serializer.serializeFragment(fragment))

  return {
    markdown,
    html: container.innerHTML,
  }
}

function buildEditorProps() {
  return {
    attributes: {
      class: 'tiptap',
    },
    handlePaste: (_view: any, event: ClipboardEvent) => {
      if (editor.state.selection.$from.parent.type.spec.code) {
        return false
      }

      const imageFiles = getImageFilesFromDataTransfer(event.clipboardData)
      if (imageFiles.length > 0) {
        event.preventDefault()
        void insertImageFiles(imageFiles)
        return true
      }

      const markdown = getMarkdownPasteContent(event)
      if (!markdown) {
        return false
      }

      return editor.commands.insertContent(markdown, { contentType: 'markdown' })
    },
    handleDrop: (view: any, event: DragEvent, _slice: any, moved: boolean) => {
      if (moved) {
        return false
      }

      const imageFiles = getImageFilesFromDataTransfer(event.dataTransfer)
      if (imageFiles.length === 0) {
        return false
      }

      const coords = view.posAtCoords({
        left: event.clientX,
        top: event.clientY,
      })
      if (coords?.pos != null) {
        editor.commands.setTextSelection(coords.pos)
      }

      event.preventDefault()
      void insertImageFiles(imageFiles)
      return true
    },
    handleDOMEvents: {
      copy: (_view: any, event: Event) => {
        const clipboardEvent = event as ClipboardEvent
        const data = clipboardEvent.clipboardData
        if (!data) {
          return false
        }

        const payload = getSelectionClipboardPayload(editor)
        if (!payload) {
          return false
        }

        data.setData('text/plain', payload.markdown)
        data.setData('text/markdown', payload.markdown)
        data.setData('text/x-markdown', payload.markdown)
        data.setData('text/html', payload.html)
        clipboardEvent.preventDefault()
        return true
      },
    },
  }
}

function shouldLoadMenusForEditor(currentEditor: Editor): boolean {
  const { selection } = currentEditor.state
  return shouldLazyLoadEditorMenus({
    hasSelectionRange: !selection.empty && selection.from !== selection.to,
    isInParagraph: selection.$from.parent.type.name === 'paragraph',
    parentText: selection.$from.parent.textContent,
    isInTable:
      currentEditor.isActive('table')
      || currentEditor.isActive('tableCell')
      || currentEditor.isActive('tableHeader'),
  })
}

function closeInsertMenu() {
  insertMenuOpen = false
  floatingMenuEl?.classList.remove('insert-menu-open')
}

function getFloatingMenuMode(currentEditor: Editor): 'hidden' | 'insert' | 'table' {
  const { selection } = currentEditor.state
  return getEditorMenuMode({
    hasSelectionRange: !selection.empty && selection.from !== selection.to,
    isInParagraph: selection.$from.parent.type.name === 'paragraph',
    parentText: selection.$from.parent.textContent,
    isInTable:
      currentEditor.isActive('table')
      || currentEditor.isActive('tableCell')
      || currentEditor.isActive('tableHeader'),
  })
}

function syncFloatingMenuMode(currentEditor: Editor) {
  floatingMenuMode = getFloatingMenuMode(currentEditor)
  if (!floatingMenuEl) {
    return
  }

  floatingMenuEl.dataset.mode = floatingMenuMode
  if (floatingMenuMode !== 'insert') {
    closeInsertMenu()
  }
}

function ensureFindBar() {
  if (findBarEl && findInputEl) {
    return
  }

  findBarEl = document.createElement('div')
  findBarEl.className = 'find-bar hidden'
  findBarEl.innerHTML = `
    <input type="text" class="find-input" placeholder="Find in document" />
    <button type="button" data-find-action="prev" title="Previous match">Prev</button>
    <button type="button" data-find-action="next" title="Next match">Next</button>
    <button type="button" data-find-action="close" title="Close find">Close</button>
  `
  document.body.appendChild(findBarEl)

  findInputEl = findBarEl.querySelector<HTMLInputElement>('.find-input')
  const maybeFind = (window as Window & {
    find?: (
      query: string,
      caseSensitive?: boolean,
      backwards?: boolean,
      wrapAround?: boolean,
      wholeWord?: boolean,
      searchInFrames?: boolean,
      showDialog?: boolean
    ) => boolean
  }).find

  const runFind = (backwards: boolean) => {
    const query = findInputEl?.value.trim() ?? ''
    if (!query || typeof maybeFind !== 'function') {
      return
    }
    lastFindQuery = query
    maybeFind(query, false, backwards, true, false, false, false)
  }

  findInputEl?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      runFind(event.shiftKey)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      closeFindBar()
    }
  })

  findBarEl.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('button[data-find-action]')
    if (!button) {
      return
    }
    const action = button.dataset.findAction
    if (action === 'prev') {
      runFind(true)
    } else if (action === 'next') {
      runFind(false)
    } else if (action === 'close') {
      closeFindBar()
    }
  })

  document.addEventListener('mousedown', (event) => {
    const target = event.target as Node | null
    const isOpen = Boolean(findBarEl && !findBarEl.classList.contains('hidden'))
    const clickedInsideFindBar = Boolean(target && findBarEl?.contains(target))
    if (!shouldCloseFindBarFromDocumentClick({ isOpen, clickedInsideFindBar })) {
      return
    }
    closeFindBar()
  })
}

function openFindBar() {
  ensureFindBar()
  if (!findBarEl || !findInputEl) {
    return
  }
  const selection = window.getSelection()?.toString().trim() ?? ''
  findBarEl.classList.remove('hidden')
  findInputEl.value = selection || lastFindQuery
  findInputEl.focus()
  findInputEl.select()
}

function closeFindBar() {
  findBarEl?.classList.add('hidden')
  findInputEl?.blur()
  editor.commands.focus()
}

function runInsertCommand(command: string) {
  const chain = editor.chain().focus()
  switch (command) {
    case 'paragraph':
      chain.setParagraph().run()
      break
    case 'heading-1':
      chain.toggleHeading({ level: 1 }).run()
      break
    case 'heading-2':
      chain.toggleHeading({ level: 2 }).run()
      break
    case 'bullet-list':
      chain.toggleBulletList().run()
      break
    case 'ordered-list':
      chain.toggleOrderedList().run()
      break
    case 'task-list':
      chain.toggleTaskList().run()
      break
    case 'table':
      chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
      break
    case 'blockquote':
      chain.toggleBlockquote().run()
      break
    case 'code-block':
      chain.toggleCodeBlock().run()
      break
    case 'image': {
      const src = window.prompt('Image URL or path:')
      if (src == null) {
        return
      }
      const alt = window.prompt('Alt text (optional):', '')
      if (alt == null) {
        return
      }
      const title = window.prompt('Title (optional):', '')
      if (!applyImageInsert(editor.commands as any, { src, alt, title })) {
        return
      }
      break
    }
    default:
      return
  }
  closeInsertMenu()
}

function ensureMenuElements() {
  if (!bubbleMenuEl) {
    bubbleMenuEl = document.createElement('div')
    bubbleMenuEl.id = 'bubble-menu'
    bubbleMenuEl.className = 'editor-bubble-menu'
    bubbleMenuEl.innerHTML = `
      <button type="button" data-command="bold" title="Bold">B</button>
      <button type="button" data-command="italic" title="Italic">I</button>
      <button type="button" data-command="code" title="Code">{ }</button>
      <button type="button" data-command="strike" title="Strikethrough">S</button>
    `
    bubbleMenuEl.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('button[data-command]')
      if (!button) {
        return
      }
      const command = button.dataset.command
      if (!command) {
        return
      }

      if (command === 'bold') {
        editor.chain().focus().toggleBold().run()
      } else if (command === 'italic') {
        editor.chain().focus().toggleItalic().run()
      } else if (command === 'code') {
        editor.chain().focus().toggleCode().run()
      } else if (command === 'strike') {
        editor.chain().focus().toggleStrike().run()
      }
    })
    document.body.appendChild(bubbleMenuEl)
  }

  if (!floatingMenuEl) {
    floatingMenuEl = document.createElement('div')
    floatingMenuEl.id = 'floating-menu'
    floatingMenuEl.className = 'editor-floating-menu'
    floatingMenuEl.innerHTML = `
      <div class="floating-menu-panel floating-menu-panel-insert">
        <button type="button" class="insert-toggle" data-command="toggle-insert" title="Insert block">+</button>
        <div class="insert-menu-items">
          <button type="button" data-command="paragraph">Text</button>
          <button type="button" data-command="heading-1">Heading 1</button>
          <button type="button" data-command="heading-2">Heading 2</button>
          <button type="button" data-command="bullet-list">Bullet List</button>
          <button type="button" data-command="ordered-list">Numbered List</button>
          <button type="button" data-command="task-list">Task List</button>
          <button type="button" data-command="table">Table</button>
          <button type="button" data-command="blockquote">Quote</button>
          <button type="button" data-command="code-block">Code Block</button>
          <button type="button" data-command="image">Image</button>
        </div>
      </div>
      <div class="floating-menu-panel floating-menu-panel-table">
        <button type="button" data-table-command="addRowBefore" title="Add row above">Row +↑</button>
        <button type="button" data-table-command="addRowAfter" title="Add row below">Row +↓</button>
        <button type="button" data-table-command="deleteRow" title="Delete row">Row -</button>
        <button type="button" data-table-command="addColumnBefore" title="Add column before">Col +←</button>
        <button type="button" data-table-command="addColumnAfter" title="Add column after">Col +→</button>
        <button type="button" data-table-command="deleteColumn" title="Delete column">Col -</button>
        <button type="button" data-table-command="toggleHeaderRow" title="Toggle header row">Header Row</button>
        <button type="button" data-table-command="toggleHeaderColumn" title="Toggle header column">Header Col</button>
        <button type="button" data-table-command="mergeOrSplit" title="Merge or split selected cells">Merge/Split</button>
        <button type="button" data-table-command="deleteTable" title="Delete table">Delete Table</button>
      </div>
    `
    floatingMenuEl.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('button[data-command]')
      if (button) {
        const command = button.dataset.command
        if (!command) {
          return
        }
        if (command === 'toggle-insert') {
          insertMenuOpen = !insertMenuOpen
          floatingMenuEl?.classList.toggle('insert-menu-open', insertMenuOpen)
          return
        }
        runInsertCommand(command)
        return
      }

      const tableButton = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('button[data-table-command]')
      if (!tableButton) {
        return
      }
      const tableCommand = tableButton.dataset.tableCommand
      if (!tableCommand) {
        return
      }
      ;(editor.chain().focus() as any)[tableCommand]().run()
    })
    document.body.appendChild(floatingMenuEl)
    syncFloatingMenuMode(editor)

    document.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null
      if (!target || !floatingMenuEl || !insertMenuOpen) {
        return
      }
      if (floatingMenuEl.contains(target)) {
        return
      }
      closeInsertMenu()
    })
  }
}

function buildEditorConfig(content: any) {
  return {
    element: document.getElementById('editor')!,
    extensions: buildExtensions(),
    content,
    autofocus: true,
    editorProps: buildEditorProps(),
    onCreate: ({ editor: currentEditor }: { editor: Editor }) => {
      if (currentEditor.getText().includes('$')) {
        void loadKatexCss()
        void migrateAllMathInEditor(currentEditor)
      }
    },
    onUpdate: ({ transaction }: { transaction: any }) => {
      if (suppressEditorUpdateSideEffects) {
        return
      }
      if (!isModified) {
        setModified(true)
      }
      if (shouldRunMathMigrationForTransaction(transaction)) {
        debouncedMigrateMath()
      }
    },
    onSelectionUpdate: ({ editor: currentEditor }: { editor: Editor }) => {
      if (!uiMenuExtensions && !uiMenusLoadPromise && shouldLoadMenusForEditor(currentEditor)) {
        void loadEditorMenus()
      }
      syncFloatingMenuMode(currentEditor)
      if (!shouldLoadMenusForEditor(currentEditor)) {
        closeInsertMenu()
      }
    },
  }
}

function recreateEditorWithSnapshot(snapshot: any, from: number, to: number) {
  editor.destroy()
  editor = new Editor(buildEditorConfig(snapshot))
  try {
    editor.commands.focus()
    const maxPos = editor.state.doc.content.size
    const safeFrom = Math.min(from, maxPos)
    const safeTo = Math.min(to, maxPos)
    if (safeFrom === safeTo) {
      editor.commands.setTextSelection(safeFrom)
    } else {
      editor.commands.setTextSelection({ from: safeFrom, to: safeTo })
    }
  } catch {
    // Ignore cursor restore errors
  }
}

function recreateEditorPreservingState() {
  const snapshot = editor.getJSON()
  const { from, to } = editor.state.selection
  recreateEditorWithSnapshot(snapshot, from, to)
}

// Initialize editor
function createEditor(content: any = '') {
  editor = new Editor(buildEditorConfig(content))
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

    codeBlockLowlightExtension = CodeBlockLowlight.configure({
      lowlight,
      defaultLanguage: 'plaintext',
    })
    recreateEditorPreservingState()

    console.log('Code highlighting loaded')
  } catch (e) {
    console.error('Failed to load code highlighting:', e)
    codeHighlightingLoaded = false
    codeBlockLowlightExtension = null
  }
}

async function loadEditorMenus(): Promise<void> {
  if (uiMenuExtensions) {
    return
  }
  if (uiMenusLoadPromise) {
    return uiMenusLoadPromise
  }

  uiMenusLoadPromise = (async () => {
    try {
      const [{ BubbleMenu }, { FloatingMenu }] = await Promise.all([
        import('@tiptap/extension-bubble-menu'),
        import('@tiptap/extension-floating-menu'),
      ])

      ensureMenuElements()

      if (!bubbleMenuEl || !floatingMenuEl) {
        return
      }

      const bubbleMenu = BubbleMenu.configure({
        element: bubbleMenuEl,
        shouldShow: ({ editor, from, to }: { editor: Editor; from: number; to: number }) => {
          if (!editor.isEditable) {
            return false
          }
          return from !== to
        },
      })

      const floatingMenu = FloatingMenu.configure({
        element: floatingMenuEl,
        shouldShow: ({ editor }: { editor: Editor }) => {
          if (!editor.isEditable) {
            return false
          }
          const mode = getFloatingMenuMode(editor)
          return mode === 'table' || (mode === 'insert' && editor.state.selection.empty)
        },
      })

      uiMenuExtensions = {
        bubbleMenu,
        floatingMenu,
      }

      recreateEditorPreservingState()
      console.log('Formatting and block insert menus loaded')
    } catch (e) {
      console.error('Failed to load editor menus:', e)
    } finally {
      uiMenusLoadPromise = null
    }
  })()

  return uiMenusLoadPromise
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

  if ((window as any).__TAURI_INTERNALS__) {
    void (async () => {
      try {
        const { invoke } = await getCoreApi()
        const { getCurrentWindow } = await getWindowApi()
        await invoke('set_window_modified', {
          label: getCurrentWindow().label,
          modified,
        })
      } catch (e) {
        console.warn('Failed to sync modified state:', e)
      }
    })()
  }
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

function getPathApi() {
  if (!pathApiPromise) {
    pathApiPromise = import('@tauri-apps/api/path')
  }
  return pathApiPromise
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
  if (!titlebarEl || !(window as any).__TAURI_INTERNALS__ || appPlatform !== 'macos') {
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
  window.addEventListener('quill:menu-find', () => {
    openFindBar()
  })

  window.addEventListener('quill:menu-print', () => {
    window.print()
  })

  if (!(window as any).__TAURI_INTERNALS__) {
    return
  }

  void (async () => {
    try {
      const { listen } = await getEventApi()
      await listen('quill://menu-new', () => {
        void newFile()
      })
      await listen('quill://menu-open', () => {
        void openFile()
      })
      await listen('quill://menu-save', () => {
        void saveFile()
      })
      await listen('quill://menu-print', () => {
        window.print()
      })
      await listen<string>('quill://menu-open-path', (event) => {
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
  const findInPage = (query: string, backwards: boolean) => {
    const maybeFind = (window as Window & {
      find?: (
        query: string,
        caseSensitive?: boolean,
        backwards?: boolean,
        wrapAround?: boolean,
        wholeWord?: boolean,
        searchInFrames?: boolean,
        showDialog?: boolean
      ) => boolean
    }).find
    if (typeof maybeFind === 'function') {
      maybeFind(query, false, backwards, true, false, false, false)
    }
  }

  const handleShortcut = async (e: KeyboardEvent) => {
    const action = getShortcutAction(e, lastFindQuery)
    if (!action) {
      return
    }

    e.preventDefault()
    e.stopPropagation()

    if (action === 'save') {
      await saveFile()
      return
    }

    if (action === 'open') {
      await openFile()
      return
    }

    if (action === 'new') {
      await newFile()
      return
    }

    if (action === 'find') {
      const mode = getFindShortcutMode(Boolean(findBarEl && !findBarEl.classList.contains('hidden')))
      if (mode === 'close') {
        closeFindBar()
      } else {
        openFindBar()
      }
      return
    }

    if (action === 'print') {
      window.print()
      return
    }

    if (action === 'findNext') {
      findInPage(lastFindQuery, false)
      return
    }

    if (action === 'findPrevious') {
      findInPage(lastFindQuery, true)
      return
    }

    if (action === 'closeWindow') {
      if ((window as any).__TAURI_INTERNALS__) {
        try {
          const { getCurrentWindow } = await getWindowApi()
          await getCurrentWindow().close()
        } catch (err) {
          console.error('Failed to close window via shortcut:', err)
        }
        return
      }

      window.close()
    }
  }

  window.addEventListener('keydown', (e) => {
    void handleShortcut(e)
  }, { capture: true })
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
async function saveFile(): Promise<string | null> {
  try {
    const { save } = await getDialogApi()
    const { writeTextFile } = await getFsApi()
    const { invoke } = await getCoreApi()

    const markdown = getMarkdownContent()

    // If we already have a file path, save directly
    const targetPath = currentFilePath ?? await save({
      defaultPath: currentFilename,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })

    if (targetPath) {
      try {
        await writeTextFile(targetPath, markdown)
      } catch (pluginWriteError) {
        await invoke('write_markdown_file', { path: targetPath, content: markdown })
        console.warn('Fell back to native file write for:', targetPath, pluginWriteError)
      }
      currentFilePath = targetPath
      setFilename(getBasename(targetPath))
      setModified(false)
      await trackRecentFile(targetPath)
    }
  } catch (e) {
    console.error('Save failed:', e)
    try {
      const { message } = await getDialogApi()
      await message(`Quill could not save this document.\n\n${String(e)}`, {
        title: 'Save Failed',
        kind: 'error',
      })
    } catch {
      window.alert(`Quill could not save this document.\n\n${String(e)}`)
    }
  }

  return currentFilePath
}

function setupCloseWarning() {
  // Native close handling lives in Rust so red-close, Cmd+W, and menu close all share one path.
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

function getImageFilesFromDataTransfer(dataTransfer: DataTransfer | null): File[] {
  if (!dataTransfer) {
    return []
  }

  const itemFiles: File[] = []
  if (dataTransfer.items) {
    for (const item of Array.from(dataTransfer.items)) {
      if (item.kind !== 'file' || !item.type.startsWith('image/')) {
        continue
      }

      const file = item.getAsFile()
      if (file) {
        itemFiles.push(file)
      }
    }
  }

  if (itemFiles.length > 0) {
    return itemFiles
  }

  return Array.from(dataTransfer.files).filter((file) => file.type.startsWith('image/'))
}

async function ensureFilePathForImageImport(): Promise<string | null> {
  if (currentFilePath) {
    return currentFilePath
  }

  const savedPath = await saveFile()
  return savedPath ?? currentFilePath
}

async function writeImageAssetForCurrentDocument(file: File): Promise<string | null> {
  const markdownFilePath = await ensureFilePathForImageImport()
  if (!markdownFilePath) {
    return null
  }

  const { mkdir, exists, writeFile } = await getFsApi()
  const { join } = await getPathApi()

  const assetDirectory = getImageAssetDirectory(markdownFilePath)
  await mkdir(assetDirectory, { recursive: true })

  let duplicateIndex = 0
  while (true) {
    const assetFilename = buildImageAssetFilename({
      originalName: file.name,
      mimeType: file.type,
      duplicateIndex,
    })
    const assetFilePath = await join(assetDirectory, assetFilename)
    if (await exists(assetFilePath)) {
      duplicateIndex += 1
      continue
    }

    const data = new Uint8Array(await file.arrayBuffer())
    await writeFile(assetFilePath, data)
    return getImageMarkdownPath(markdownFilePath, assetFilePath)
  }
}

async function insertImageFiles(files: File[]): Promise<void> {
  for (const file of files) {
    try {
      const src = await writeImageAssetForCurrentDocument(file)
      if (!src) {
        return
      }

      applyImageInsert(editor.commands as any, {
        src,
        alt: null,
        title: file.name || null,
      })
    } catch (error) {
      console.error('Failed to insert image file:', error)
    }
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

  appPlatform = resolveAppPlatform({
    href: window.location.href,
    userAgent: navigator.userAgent,
    navigatorPlatform: navigator.platform,
  })

  const appRoot = document.getElementById('app')
  appRoot?.classList.add(getPlatformClassName(appPlatform))

  // Initialize DOM element references
  filenameEl = document.getElementById('filename')!
  modifiedIndicator = document.getElementById('modified-indicator')!

  const tCreateEditorStart = nowMs()
  createEditor()
  logPerf('createEditor', tCreateEditorStart)
  setupKeyboardShortcuts()
  setupMenuEventListeners()
  setupCloseWarning()
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
