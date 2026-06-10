import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { createQuillEditor, ensureGrammarsForDoc, getMarkdown, setMarkdown } from './editor-setup'
import { FileOps } from './file-ops'
import { selectStartupFiles } from './startup-files'
import { BubbleMenu } from './ui/bubble-menu'
import { LinkPopover } from './ui/link-popover'
import { MathPopover } from './ui/math-popover'
import { SlashMenu } from './ui/slash-menu'
import { FindBar } from './ui/find-bar'
import { elementAnchor } from './ui/popover'
import { showToast } from './ui/toast'

import 'katex/dist/katex.min.css'

declare global {
  interface Window {
    openedFiles?: string[]
    quillDebug?: { editor: Editor; getMarkdown: () => string; setMarkdown: (md: string) => void }
  }
}

function logPerf(label: string, startMs: number): void {
  if (import.meta.env.DEV) {
    console.log(`[perf] ${label}: ${(performance.now() - startMs).toFixed(1)}ms`)
  }
}

async function openUrlExternally(url: string): Promise<void> {
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(url)
  } catch (e) {
    console.error('Failed to open URL:', e)
    showToast(`Couldn't open link: ${e}`, { kind: 'error' })
  }
}

async function showCurrentWindow(): Promise<void> {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const win = getCurrentWindow()
    await win.show()
    // Programmatically-shown windows don't take keyboard focus on their own.
    await win.setFocus()
  } catch (e) {
    console.error('Failed to show window:', e)
  }
}

async function setNativeTitle(title: string): Promise<void> {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().setTitle(title)
  } catch {
    // Browser harness: no native window.
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const tStartup = performance.now()
  const params = new URL(window.location.href).searchParams
  if (params.get('keepalive') === '1') return

  const filenameEl = document.getElementById('filename')!
  const modifiedIndicator = document.getElementById('modified-indicator')!
  const wordCountEl = document.getElementById('word-count')!
  const editorEl = document.getElementById('editor')!

  // --- editor ---
  let fileOps: FileOps
  let linkPopover: LinkPopover
  let mathPopover: MathPopover

  const editor = createQuillEditor(editorEl, {
    onDocChanged: () => {
      fileOps.noteDocChanged()
      scheduleWordCount()
      scheduleGrammarCheck()
    },
    onLinkClick: anchor => linkPopover.showForLink(anchor),
    onInlineMathClick: (node, pos) => {
      const dom = editor.view.nodeDOM(pos) as HTMLElement | null
      if (dom) mathPopover.show('inline', node.attrs.latex, pos, elementAnchor(dom))
    },
    onBlockMathClick: (node, pos) => {
      const dom = editor.view.nodeDOM(pos) as HTMLElement | null
      if (dom) mathPopover.show('block', node.attrs.latex, pos, elementAnchor(dom))
    },
    onOpenUrl: url => void openUrlExternally(url),
  })
  logPerf('createEditor', tStartup)

  // --- UI state ---
  function applyFileState(state: { filename: string; dirty: boolean }): void {
    filenameEl.textContent = state.filename
    modifiedIndicator.classList.toggle('hidden', !state.dirty)
    document.title = `${state.filename} - Quill`
    void setNativeTitle(`${state.filename}${state.dirty ? ' — Edited' : ''}`)
  }

  fileOps = new FileOps(editor, { onStateChange: applyFileState })

  // --- word count (idle-updated, cheap) ---
  let wordCountTimer: ReturnType<typeof setTimeout> | undefined
  function updateWordCount(): void {
    const storage = (editor.storage as Record<string, any>).characterCount
    const words: number = storage?.words?.() ?? 0
    wordCountEl.textContent = words === 0 ? '' : `${words.toLocaleString()} word${words === 1 ? '' : 's'}`
  }
  function scheduleWordCount(): void {
    clearTimeout(wordCountTimer)
    wordCountTimer = setTimeout(updateWordCount, 300)
  }

  // New code blocks (typed ```lang fences) may need their grammar fetched.
  let grammarTimer: ReturnType<typeof setTimeout> | undefined
  function scheduleGrammarCheck(): void {
    clearTimeout(grammarTimer)
    grammarTimer = setTimeout(() => ensureGrammarsForDoc(editor), 400)
  }

  // --- chrome ---
  linkPopover = new LinkPopover(editor, url => void openUrlExternally(url))
  mathPopover = new MathPopover(editor)
  const bubbleMenu = new BubbleMenu(editor, () => linkPopover.showEditor())
  const slashMenu = new SlashMenu(editor, {
    // Inserting math from the slash menu drops straight into the LaTeX editor
    onMathInserted: (kind, pos) => {
      requestAnimationFrame(() => {
        const node = editor.state.doc.nodeAt(pos)
        const dom = editor.view.nodeDOM(pos) as HTMLElement | null
        if (node && dom) mathPopover.show(kind, node.attrs.latex, pos, elementAnchor(dom))
      })
    },
  })
  const findBar = new FindBar(editor)
  void bubbleMenu
  void slashMenu

  // --- keyboard shortcuts ---
  document.addEventListener('keydown', e => {
    const mod = e.metaKey || e.ctrlKey
    if (!mod) return
    // e.code, not e.key: with Alt held, macOS gives composed chars ("ƒ" for F)
    const key = e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : e.key.toLowerCase()

    if (key === 's') {
      e.preventDefault()
      void fileOps.save(e.shiftKey)
    } else if (key === 'o') {
      e.preventDefault()
      void fileOps.openViaDialog()
    } else if (key === 'n' && !e.shiftKey) {
      e.preventDefault()
      void fileOps.newFile()
    } else if (key === 'k' && !e.shiftKey) {
      if (!editor.state.selection.empty || editor.isActive('link')) {
        e.preventDefault()
        linkPopover.showEditor()
      }
    } else if (key === 'f' && !e.shiftKey) {
      e.preventDefault()
      findBar.show(e.altKey)
    }
    // Cmd+B/I/U/E and Cmd+Z/Shift+Z are handled by the editor's own keymaps.
  })

  // --- startup file ---
  applyFileState(fileOps.state)
  const startupFiles = selectStartupFiles(
    window.openedFiles,
    params.get('open') ? [params.get('open')!] : [],
  )

  if (startupFiles.length > 0) {
    const tOpen = performance.now()
    await fileOps.loadPath(startupFiles[0])
    logPerf(`open startup file`, tOpen)
  } else {
    fileOps.maybeOfferDraft('')
  }
  updateWordCount()
  editor.view.focus()
  // WebKit can resync an odd whole-document selection on programmatic focus;
  // make sure boot always starts from a collapsed caret.
  if (!(editor.state.selection instanceof TextSelection)) {
    editor.commands.setTextSelection(0)
  }

  // When the OS window regains focus with nothing else focused in the page,
  // put the caret back in the editor so typing always works.
  window.addEventListener('focus', () => {
    const active = document.activeElement
    if (!active || active === document.body || active === editor.view.dom) {
      editor.view.focus()
    }
  })

  // --- native window wiring (no-ops in the browser harness) ---
  void fileOps.guardWindowClose()
  void (async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      await win.listen<string>('menu', ({ payload }) => {
        switch (payload) {
          case 'new': void fileOps.newFile(); break
          case 'open': void fileOps.openViaDialog(); break
          case 'save': void fileOps.save(); break
          case 'save-as': void fileOps.save(true); break
          case 'undo': editor.chain().focus().undo().run(); break
          case 'redo': editor.chain().focus().redo().run(); break
          case 'find': findBar.show(false); break
          case 'find-replace': findBar.show(true); break
          case 'clear-recents': FileOps.clearRecents(); break
        }
      })
      await win.listen<string>('menu-open-path', ({ payload }) => {
        void fileOps.openRecent(payload)
      })
      fileOps.syncRecentsToMenu()
    } catch {
      // Browser harness: no native menu.
    }
  })()
  const tShow = performance.now()
  await showCurrentWindow()
  logPerf('showCurrentWindow', tShow)
  logPerf('startup total', tStartup)

  // Tiny harness/debug seam; kept in production builds (negligible cost).
  window.quillDebug = { editor, getMarkdown: () => getMarkdown(editor), setMarkdown: (md: string) => setMarkdown(editor, md) }
})
