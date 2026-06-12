// File lifecycle: open/save/save-as/new, dirty tracking, recent files,
// crash-recovery drafts, and unsaved-changes guard on window close.
import type { Editor } from '@tiptap/core'
import { getMarkdown, setMarkdown } from './editor-setup'
import { configureImages } from './images'
import { showToast } from './ui/toast'

const RECENT_KEY = 'quill-recent-files'
const RECENT_MAX = 8
const DRAFT_PREFIX = 'quill-draft:'
const DRAFT_INTERVAL_MS = 1500

export interface FileState {
  path: string | null
  filename: string
  dirty: boolean
}

interface FileOpsCallbacks {
  onStateChange: (state: FileState) => void
}

function getBasename(filePath: string): string {
  const parts = filePath.split(/[/\\]/)
  return parts[parts.length - 1] || 'untitled.md'
}

function getDirname(filePath: string): string {
  const i = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return i >= 0 ? filePath.slice(0, i) : '.'
}

/** Stable short name for pasted image bytes so re-pasting reuses the file. */
function hashBytes(bytes: Uint8Array): string {
  let h = 0x811c9dc5
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

async function invokeBackend<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

export class FileOps {
  private editor: Editor
  private callbacks: FileOpsCallbacks
  private path: string | null = null
  private dirty = false
  private draftTimer: ReturnType<typeof setTimeout> | undefined
  private saving = false

  constructor(editor: Editor, callbacks: FileOpsCallbacks) {
    this.editor = editor
    this.callbacks = callbacks

    // Warm the plugin modules off the critical path so the first ⌘S is instant.
    const warm = () => {
      void import('@tauri-apps/plugin-dialog')
      void import('@tauri-apps/plugin-fs')
    }
    if ('requestIdleCallback' in window) {
      requestIdleCallback(warm, { timeout: 3000 })
    } else {
      setTimeout(warm, 1500)
    }

    this.refreshImageContext(null)
  }

  /**
   * Point the image layer at the current document: relative srcs render against
   * its directory, and pasted/dropped images get written into `<dir>/assets/`.
   * Pass the path explicitly when it isn't on `this.path` yet (e.g. before
   * setMarkdown during a load) so the first render can resolve local images.
   */
  private refreshImageContext(path: string | null = this.path): void {
    configureImages({
      baseDir: path ? getDirname(path) : null,
      saver: async (bytes, ext) => {
        if (!this.path) {
          showToast('Save the document first to add images', { kind: 'info' })
          return null
        }
        const name = `img-${hashBytes(bytes)}.${ext}`
        const abs = `${getDirname(this.path)}/assets/${name}`
        try {
          await invokeBackend('write_image_file', { path: abs, contents: Array.from(bytes) })
        } catch (e) {
          console.error('Image write failed:', e)
          showToast(`Couldn't save image: ${e}`, { kind: 'error' })
          return null
        }
        return `assets/${name}`
      },
    })
  }

  get state(): FileState {
    return {
      path: this.path,
      filename: this.path ? getBasename(this.path) : 'untitled.md',
      dirty: this.dirty,
    }
  }

  get isDirty(): boolean {
    return this.dirty
  }

  /** Hook for editor onUpdate with docChanged */
  noteDocChanged(): void {
    if (!this.dirty) this.setDirty(true)
    clearTimeout(this.draftTimer)
    this.draftTimer = setTimeout(() => this.writeDraft(), DRAFT_INTERVAL_MS)
  }

  private setDirty(dirty: boolean): void {
    if (this.dirty === dirty) return
    this.dirty = dirty
    this.emit()
    // Native window affordances (red close-button dot on macOS) + quit guard
    void invokeBackend('set_window_dirty', { dirty }).catch(() => {})
  }

  private emit(): void {
    this.callbacks.onStateChange(this.state)
  }

  // --- drafts (crash recovery) ---

  private draftKey(): string {
    return DRAFT_PREFIX + (this.path ?? 'untitled')
  }

  private writeDraft(): void {
    if (!this.dirty) return
    try {
      localStorage.setItem(
        this.draftKey(),
        JSON.stringify({ markdown: getMarkdown(this.editor), time: Date.now() }),
      )
    } catch {
      // Storage full or unavailable: drafts are best-effort.
    }
  }

  private clearDraft(): void {
    clearTimeout(this.draftTimer)
    localStorage.removeItem(this.draftKey())
  }

  /** Offer to restore a newer draft for the current path, if one exists. */
  maybeOfferDraft(loadedContent: string): void {
    let draft: { markdown: string; time: number } | null = null
    try {
      const raw = localStorage.getItem(this.draftKey())
      if (raw) draft = JSON.parse(raw)
    } catch {
      return
    }
    if (!draft?.markdown || draft.markdown.trim() === loadedContent.trim()) {
      localStorage.removeItem(this.draftKey())
      return
    }
    const when = new Date(draft.time).toLocaleString()
    showToast(`Unsaved draft from ${when} found`, {
      kind: 'info',
      duration: 10000,
      action: {
        label: 'Restore',
        onClick: () => {
          setMarkdown(this.editor, draft.markdown)
          this.setDirty(true)
        },
      },
    })
  }

  // --- recent files ---

  static recentFiles(): string[] {
    try {
      const raw = localStorage.getItem(RECENT_KEY)
      const list = raw ? JSON.parse(raw) : []
      return Array.isArray(list) ? list.filter(f => typeof f === 'string') : []
    } catch {
      return []
    }
  }

  static clearRecents(): void {
    localStorage.removeItem(RECENT_KEY)
  }

  private touchRecent(path: string): void {
    const list = FileOps.recentFiles().filter(f => f !== path)
    list.unshift(path)
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)))
    } catch {
      // best-effort
    }
    this.syncRecentsToMenu()
  }

  /** Push the recents list into the native File > Open Recent menu. */
  syncRecentsToMenu(): void {
    void invokeBackend('update_recent_files', { paths: FileOps.recentFiles() }).catch(() => {})
  }

  // --- core operations ---

  async save(saveAs = false): Promise<boolean> {
    if (this.saving) return false
    this.saving = true
    try {
      const markdown = getMarkdown(this.editor)

      let targetPath = this.path
      if (saveAs || !targetPath) {
        const { save } = await import('@tauri-apps/plugin-dialog')
        targetPath = await save({
          defaultPath: this.path ?? this.state.filename,
          filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
        })
        if (!targetPath) return false
      }

      const { writeTextFile } = await import('@tauri-apps/plugin-fs')
      await writeTextFile(targetPath, markdown)

      this.clearDraft()
      this.path = targetPath
      this.refreshImageContext()
      this.setDirty(false)
      this.touchRecent(targetPath)
      this.emit()
      return true
    } catch (e) {
      console.error('Save failed:', e)
      showToast(`Save failed: ${e}`, { kind: 'error' })
      return false
    } finally {
      this.saving = false
    }
  }

  async openViaDialog(): Promise<void> {
    if (!(await this.confirmDiscard())) return
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const filePath = await open({
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
        multiple: false,
      })
      if (typeof filePath === 'string') {
        await this.loadPath(filePath)
      }
    } catch (e) {
      console.error('Open failed:', e)
      showToast(`Open failed: ${e}`, { kind: 'error' })
    }
  }

  /** Load a file into this window (no discard confirmation; callers decide). */
  async loadPath(filePath: string): Promise<boolean> {
    try {
      let content: string
      try {
        const { readTextFile } = await import('@tauri-apps/plugin-fs')
        content = await readTextFile(filePath)
      } catch {
        content = await invokeBackend<string>('read_markdown_file', { path: filePath })
      }

      // Set the image base dir before rendering so local images resolve.
      this.refreshImageContext(filePath)
      setMarkdown(this.editor, content)
      this.path = filePath
      this.setDirty(false)
      this.touchRecent(filePath)
      this.emit()
      this.maybeOfferDraft(content)
      return true
    } catch (e) {
      console.error('Failed to open file:', e)
      showToast(`Couldn't open ${getBasename(filePath)}: ${e}`, { kind: 'error' })
      return false
    }
  }

  async openRecent(filePath: string): Promise<void> {
    if (!(await this.confirmDiscard())) return
    await this.loadPath(filePath)
  }

  async newFile(): Promise<void> {
    if (!(await this.confirmDiscard())) return
    this.clearDraft()
    this.editor.commands.clearContent(true)
    this.path = null
    this.refreshImageContext(null)
    this.setDirty(false)
    this.emit()
    this.editor.commands.focus()
  }

  async confirmDiscard(): Promise<boolean> {
    if (!this.dirty) return true
    try {
      const { ask } = await import('@tauri-apps/plugin-dialog')
      return await ask(`"${this.state.filename}" has unsaved changes. Discard them?`, {
        title: 'Unsaved Changes',
        kind: 'warning',
        okLabel: 'Discard',
        cancelLabel: 'Cancel',
      })
    } catch {
      return window.confirm('You have unsaved changes. Discard them?')
    }
  }

  /** Wire the unsaved-changes guard into the native window close. */
  async guardWindowClose(): Promise<void> {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      await win.onCloseRequested(async event => {
        if (!this.dirty) return
        event.preventDefault()
        const { ask } = await import('@tauri-apps/plugin-dialog')
        const save = await ask(
          `Save changes to "${this.state.filename}" before closing?`,
          {
            title: 'Unsaved Changes',
            kind: 'warning',
            okLabel: 'Save',
            cancelLabel: 'Don’t Save',
          },
        )
        if (save) {
          const saved = await this.save()
          if (!saved) return // user cancelled the save dialog: abort close
        } else {
          // Keep the draft so nothing is silently lost.
          this.writeDraft()
        }
        this.setDirty(false)
        await win.destroy()
      })
    } catch (e) {
      console.error('Failed to install close guard:', e)
    }
  }
}
