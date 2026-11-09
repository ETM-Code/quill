import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { createQuillEditor, ensureGrammarsForDoc, getMarkdown, setMarkdown } from './editor-setup'
import { FileOps } from './file-ops'
import { selectStartupFiles } from './startup-files'
import { BubbleMenu } from './ui/bubble-menu'
import { LinkPopover } from './ui/link-popover'
import { MathPopover } from './ui/math-popover'
import { MermaidPopover } from './ui/mermaid-popover'
import { SlashMenu } from './ui/slash-menu'
import { FindBar } from './ui/find-bar'
import { elementAnchor } from './ui/popover'
import { showToast } from './ui/toast'
import { ImagePopover } from './ui/image-popover'
import {
  classifyLink, describeTarget, homeDir, openExternalUrl, openLocalPath, openMarkdownWindow, revealLocalPath,
} from './ui/link-router'
import { installNativeDragDrop, handleDroppedPaths } from './ui/drag-drop'
import { SourceView } from './ui/source-view'
import { Outline } from './ui/outline'
import { printDocument } from './ui/print'
import {
  findHeadingBySlug, formatCommands, installUxPlugins, setImageHandlers, setInlineMathHandler,
} from './extensions'
import { configureImages, localImagePath, isExternalSrc } from './images'


declare global {
  interface Window {
    openedFiles?: string[]
    quillDebug?: {
      editor: Editor
      getMarkdown: () => string
      setMarkdown: (md: string) => void
      /** UX seams for the harness */
      ux?: Record<string, unknown>
    }
  }
}

function logPerf(label: string, startMs: number): void {
  if (import.meta.env.DEV) {
    console.log(`[perf] ${label}: ${(performance.now() - startMs).toFixed(1)}ms`)
  }
}

async function insertImageViaDialog(editor: Editor): Promise<void> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const picked = await open({
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'] }],
      multiple: false,
    })
    if (typeof picked !== 'string') return
    const { readFile } = await import('@tauri-apps/plugin-fs')
    const bytes = await readFile(picked)
    const ext = picked.slice(picked.lastIndexOf('.') + 1).toLowerCase() || 'png'
    const { insertImageBytes, altFromFilename } = await import('./images')
    await insertImageBytes(editor, bytes, ext, { alt: altFromFilename(picked) })
  } catch (e) {
    console.error('Insert image failed:', e)
    showToast(`Couldn't insert image: ${e}`, { kind: 'error' })
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
  // Math and diagram editors are built on first use (most documents never open them).
  let mathPopoverInst: MathPopover | undefined
  let mermaidPopoverInst: MermaidPopover | undefined
  const mathPopover = {
    show: (...args: Parameters<MathPopover['show']>) => (mathPopoverInst ??= new MathPopover(editor)).show(...args),
  }
  const mermaidPopover = {
    show: (...args: Parameters<MermaidPopover['show']>) => (mermaidPopoverInst ??= new MermaidPopover(editor)).show(...args),
  }

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
    onMermaidClick: (code, pos) => {
      const dom = editor.view.nodeDOM(pos) as HTMLElement | null
      if (dom) mermaidPopover.show(code, pos, elementAnchor(dom))
    },
    onOpenUrl: url => void openLink(url),
  })
  // UX plugins (keymaps, heading ids, link/image interactions, table
  // controls) when editor-setup didn't already include uxExtensions.
  installUxPlugins(editor)
  logPerf('createEditor', tStartup)

  // --- links ---
  let home: string | null = null
  void homeDir().then(h => (home = h))
  const targetOf = (href: string) => classifyLink(href, fileOps?.state.path ?? null, home)

  let flashEl: HTMLDivElement | null = null
  function flash(el: HTMLElement): void {
    if (!flashEl) {
      flashEl = document.createElement('div')
      flashEl.className = 'anchor-flash'
      document.body.appendChild(flashEl)
    }
    const r = el.getBoundingClientRect()
    Object.assign(flashEl.style, {
      left: `${r.left - 6}px`, top: `${r.top - 2}px`, width: `${r.width + 12}px`, height: `${r.height + 4}px`,
    })
    flashEl.classList.remove('on')
    void flashEl.offsetWidth
    flashEl.classList.add('on')
    // Fixed overlay: drop it as soon as the page moves under it.
    const container = document.getElementById('editor-container')
    const stop = () => flashEl?.classList.remove('on')
    setTimeout(() => container?.addEventListener('scroll', stop, { once: true, passive: true }), 50)
  }

  function scrollToAnchor(anchor: string): boolean {
    const pos = findHeadingBySlug(editor.state.doc, anchor)
    if (pos == null) {
      showToast(`No heading “${anchor}” in this document`, { kind: 'info' })
      return false
    }
    editor.chain().setTextSelection(pos + 1).focus(undefined, { scrollIntoView: false }).run()
    const dom = editor.view.nodeDOM(pos) as HTMLElement | null
    if (dom) {
      dom.scrollIntoView({ block: 'start' })
      requestAnimationFrame(() => flash(dom))
    }
    return true
  }

  async function openLink(href: string): Promise<void> {
    const target = targetOf(href)
    switch (target.kind) {
      case 'anchor':
        scrollToAnchor(target.anchor)
        break
      case 'external':
        await openExternalUrl(target.url)
        break
      case 'markdown':
        if (isPristine()) {
          if (await fileOps.loadPath(target.path)) {
            if (target.anchor) scrollToAnchor(target.anchor)
          }
        } else {
          await openMarkdownWindow(target.path, target.anchor)
        }
        break
      case 'file':
        await openLocalPath(target.path)
        break
      case 'unsupported':
        showToast(target.reason, {
          kind: 'info',
          action: { label: 'Copy link', onClick: () => void navigator.clipboard.writeText(target.href) },
        })
        break
    }
  }

  function isPristine(): boolean {
    return !fileOps.state.path && !fileOps.isDirty && editor.isEmpty
  }

  // --- images ---
  function openImage(src: string): void {
    const local = localImagePath(src)
    if (local) void openLocalPath(local)
    else if (/^https?:/i.test(src)) void openExternalUrl(src)
    else if (!isExternalSrc(src)) showToast('Save the document to open its images', { kind: 'info' })
  }
  const imagePopover = new ImagePopover(editor, {
    open: openImage,
    reveal: path => void revealLocalPath(path),
    localPath: localImagePath,
  })
  setImageHandlers({
    onSelect: (pos, dom) => imagePopover.show(pos, dom),
    onOpen: pos => {
      imagePopover.hide()
      const src = editor.state.doc.nodeAt(pos)?.attrs.src as string | undefined
      if (src) openImage(src)
    },
  })
  configureImages({
    // Untitled document: offer Save As instead of dropping the image.
    ensureSaved: async () => {
      let ok = false
      try {
        const { ask } = await import('@tauri-apps/plugin-dialog')
        ok = await ask('Images are stored in an “assets” folder next to the document. Save the document first?', {
          title: 'Save Document to Add Images',
          kind: 'info',
          okLabel: 'Save…',
          cancelLabel: 'Cancel',
        })
      } catch {
        ok = window.confirm('Save the document first to add images?')
      }
      return ok && (await fileOps.save(true))
    },
  })

  // --- UI state ---
  function applyFileState(state: { filename: string; dirty: boolean }): void {
    filenameEl.textContent = state.filename
    modifiedIndicator.classList.toggle('hidden', !state.dirty)
    document.title = `${state.filename} - Quill`
    void setNativeTitle(`${state.filename}${state.dirty ? ' — Edited' : ''}`)
  }

  let reportedPath: string | null | undefined
  fileOps = new FileOps(editor, {
    onStateChange: state => {
      applyFileState(state)
      const path = fileOps?.state.path ?? null
      if (path !== reportedPath) {
        reportedPath = path
        void import('@tauri-apps/api/core')
          .then(({ invoke }) => invoke('set_window_path', { path }))
          .catch(() => {})
      }
    },
  })

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
  linkPopover = new LinkPopover(editor, url => void openLink(url), href => describeTarget(targetOf(href)))
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
    onInsertImage: () => void insertImageViaDialog(editor),
    onMermaidInserted: (pos) => {
      requestAnimationFrame(() => {
        const node = editor.state.doc.nodeAt(pos)
        const dom = editor.view.nodeDOM(pos) as HTMLElement | null
        if (node && dom) mermaidPopover.show(node.attrs.code as string, pos, elementAnchor(dom))
      })
    },
  })
  const findBar = new FindBar(editor)
  void bubbleMenu
  void slashMenu
  setInlineMathHandler(pos => {
    const node = editor.state.doc.nodeAt(pos)
    const dom = editor.view.nodeDOM(pos) as HTMLElement | null
    if (node && dom) mathPopover.show('inline', node.attrs.latex as string, pos, elementAnchor(dom))
  })

  // --- views: source mode, outline, print ---
  const sourceView = new SourceView({
    editor,
    container: document.getElementById('editor-container')!,
    getMarkdown: () => getMarkdown(editor),
    setMarkdown: md => setMarkdown(editor, md, { undoable: true }),
    onDirty: () => fileOps.noteDocChanged(),
  })
  const outline = new Outline(editor)
  async function print(): Promise<void> {
    sourceView.commit()
    if (sourceView.active) sourceView.toggle()
    await printDocument()
  }
  async function save(saveAs = false): Promise<void> {
    sourceView.commit()
    await fileOps.save(saveAs)
  }

  const format = formatCommands(editor)
  function runMenuCommand(id: string): boolean {
    if (sourceView.active && (id.startsWith('format-') || id.startsWith('insert-'))) return true
    const heading = /^format-h([1-6])$/.exec(id)
    if (heading) {
      format.heading(Number(heading[1]) as 1 | 2 | 3 | 4 | 5 | 6)
      return true
    }
    switch (id) {
      case 'format-paragraph': format.paragraph(); return true
      case 'format-bold': format.bold(); return true
      case 'format-italic': format.italic(); return true
      case 'format-underline': format.underline(); return true
      case 'format-strike': format.strike(); return true
      case 'format-highlight': format.highlight(); return true
      case 'format-code': format.code(); return true
      case 'format-math': format.inlineMath(); return true
      case 'format-clear': format.clearFormatting(); return true
      case 'format-link': linkPopover.showEditor(); return true
      case 'format-bullet': format.bulletList(); return true
      case 'format-ordered': format.orderedList(); return true
      case 'format-task': format.taskList(); return true
      case 'format-quote': format.quote(); return true
      case 'format-codeblock': format.codeBlock(); return true
      case 'copy-plain': if (!sourceView.active) format.copyPlain(); return true
      case 'insert-table': format.table(); return true
      case 'insert-rule': format.rule(); return true
      case 'insert-image': void insertImageViaDialog(editor); return true
      case 'insert-math': {
        const { from } = editor.state.selection
        if (editor.chain().focus().insertBlockMath({ latex: 'x = y' }).run()) {
          requestAnimationFrame(() => {
            let at = -1
            editor.state.doc.nodesBetween(Math.max(0, from - 2), Math.min(editor.state.doc.content.size, from + 4), (n, p) => {
              if (at < 0 && n.type.name === 'blockMath') at = p
            })
            const dom = at >= 0 ? (editor.view.nodeDOM(at) as HTMLElement | null) : null
            if (dom) mathPopover.show('block', 'x = y', at, elementAnchor(dom))
          })
        }
        return true
      }
      case 'insert-mermaid': {
        const code = 'graph TD\n  A[Start] --> B[End]'
        editor.chain().focus().insertContent({ type: 'mermaid', attrs: { code } }).run()
        return true
      }
      case 'toggle-source': sourceView.toggle(); return true
      case 'toggle-outline': outline.toggle(); return true
      case 'print': void print(); return true
    }
    return false
  }

  // --- keyboard shortcuts ---
  document.addEventListener('keydown', e => {
    const mod = e.metaKey || e.ctrlKey
    if (!mod) return
    // e.code, not e.key: with Alt held, macOS gives composed chars ("ƒ" for F)
    const key = e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : e.key.toLowerCase()

    if (key === 's') {
      e.preventDefault()
      void save(e.shiftKey)
    } else if (e.code === 'Slash' && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      sourceView.toggle()
    } else if (key === 'o' && e.shiftKey && !e.altKey) {
      e.preventDefault()
      outline.toggle()
    } else if (key === 'p' && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      void print()
    } else if (key === 'o' && !e.shiftKey) {
      e.preventDefault()
      void fileOps.openViaDialog()
    } else if (key === 'n' && !e.shiftKey) {
      e.preventDefault()
      void fileOps.newFile()
    } else if (key === 'k' && !e.shiftKey) {
      if (sourceView.active) return
      if (!editor.state.selection.empty || editor.isActive('link')) {
        e.preventDefault()
        linkPopover.showEditor()
      }
    } else if (key === 'f' && !e.shiftKey) {
      e.preventDefault()
      if (sourceView.active) sourceView.toggle()
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
    const anchor = params.get('anchor')
    if (anchor) requestAnimationFrame(() => scrollToAnchor(anchor))
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
  const dropHost = {
    editor,
    docPath: () => fileOps.state.path,
    isPristine,
    loadHere: (path: string) => fileOps.loadPath(path),
    openMarkdown: (path: string) => openMarkdownWindow(path, null),
  }
  void installNativeDragDrop(dropHost)
  void fileOps.guardWindowClose()
  void (async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      await win.listen<string>('menu', ({ payload }) => {
        switch (payload) {
          case 'new': void fileOps.newFile(); break
          case 'open': void fileOps.openViaDialog(); break
          case 'save': void save(); break
          case 'save-as': void save(true); break
          case 'undo': editor.chain().focus().undo().run(); break
          case 'redo': editor.chain().focus().redo().run(); break
          case 'find': findBar.show(false); break
          case 'find-replace': findBar.show(true); break
          case 'clear-recents': FileOps.clearRecents(); break
          default: runMenuCommand(payload)
        }
      })
      await win.listen<string>('scroll-to-anchor', ({ payload }) => {
        scrollToAnchor(payload)
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
  window.quillDebug = {
    editor,
    getMarkdown: () => getMarkdown(editor),
    setMarkdown: (md: string) => setMarkdown(editor, md),
    ux: {
      openLink: (href: string) => openLink(href),
      classify: (href: string) => targetOf(href),
      menu: (id: string) => runMenuCommand(id),
      dropPaths: (paths: string[], x?: number, y?: number) =>
        handleDroppedPaths(dropHost, paths, x == null || y == null ? null : { x, y }),
      sourceView,
      outline,
      isDirty: () => fileOps.isDirty,
      path: () => fileOps.state.path,
    },
  }
})
