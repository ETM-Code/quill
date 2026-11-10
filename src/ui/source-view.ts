// Raw-markdown source mode (⌘/): swaps the WYSIWYG editor for a plain textarea
// holding the document's markdown. Edits are pushed back into the editor
// (debounced, and on commit() before save/print/toggle).
import type { Editor } from '@tiptap/core'
import './views.css'

export interface SourceViewOptions {
  editor: Editor
  /** #editor-container: the scrolling element that hosts the editor */
  container: HTMLElement
  getMarkdown: () => string
  setMarkdown: (md: string) => void
  /** Called on every edit in source mode (marks the document dirty) */
  onDirty: () => void
}

const APPLY_DELAY_MS = 300

let current: SourceView | null = null

/** Leave source mode if it is active (used by the outline before navigating). */
export function exitSourceMode(): void {
  if (current?.active) current.toggle()
}

export class SourceView {
  private ta: HTMLTextAreaElement | null = null
  private pill: HTMLSpanElement
  private isActive = false
  /** Text last known to be in the editor (what the textarea started from / was last applied) */
  private applied = ''
  private applyTimer: ReturnType<typeof setTimeout> | undefined
  private applying = false
  /** Whether the user edited the text since entering (or since the doc was replaced) */
  private touched = false
  /** Container scroll position when source mode was entered */
  private enterScrollTop = 0
  private onEditorUpdate = () => {
    // The document was replaced underneath us (file load, new file): follow it.
    if (!this.isActive || this.applying || !this.ta) return
    const md = this.opts.getMarkdown()
    this.ta.value = md
    this.applied = md
    this.touched = false
  }

  constructor(private opts: SourceViewOptions) {
    current = this
    this.pill = document.createElement('span')
    this.pill.className = 'source-pill'
    this.pill.textContent = 'Markdown'
    this.pill.title = 'Markdown source (⌘/ to return)'
    const right = document.querySelector('.titlebar-right')
    if (right) right.insertBefore(this.pill, right.firstChild)
  }

  get active(): boolean {
    return this.isActive
  }

  /** Push pending source edits into the editor (before save/print). */
  commit(): void {
    clearTimeout(this.applyTimer)
    this.applyTimer = undefined
    if (!this.isActive || !this.ta) return
    this.apply(this.ta.value)
  }

  toggle(): void {
    if (this.isActive) this.exit()
    else this.enter()
  }

  private apply(value: string): void {
    if (value === this.applied) return
    this.applying = true
    try {
      this.opts.setMarkdown(value)
    } finally {
      this.applying = false
    }
    this.applied = value
  }

  private ensureTextarea(): HTMLTextAreaElement {
    if (this.ta) return this.ta
    const ta = document.createElement('textarea')
    ta.className = 'source-textarea'
    ta.spellcheck = false
    ta.autocomplete = 'off'
    ta.setAttribute('autocapitalize', 'off')
    ta.setAttribute('autocorrect', 'off')
    ta.setAttribute('aria-label', 'Markdown source')
    ta.addEventListener('input', () => {
      this.touched = true
      this.opts.onDirty()
      clearTimeout(this.applyTimer)
      this.applyTimer = setTimeout(() => {
        this.applyTimer = undefined
        if (this.isActive && this.ta) this.apply(this.ta.value)
      }, APPLY_DELAY_MS)
    })
    ta.addEventListener('keydown', e => this.onKeyDown(e))
    this.opts.container.appendChild(ta)
    this.ta = ta
    return ta
  }

  private onKeyDown(e: KeyboardEvent): void {
    const ta = this.ta
    if (!ta || e.key !== 'Tab' || e.metaKey || e.ctrlKey || e.altKey) return
    e.preventDefault()
    if (e.shiftKey) {
      this.outdent(ta)
      return
    }
    // execCommand keeps the native undo stack; fall back to direct edit.
    let ok = false
    try {
      ok = document.execCommand('insertText', false, '  ')
    } catch {
      ok = false
    }
    if (!ok) {
      ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    }
  }

  /** Shift+Tab: remove up to two leading spaces from the selected lines. */
  private outdent(ta: HTMLTextAreaElement): void {
    const { value, selectionStart, selectionEnd } = ta
    const start = value.lastIndexOf('\n', selectionStart - 1) + 1
    const block = value.slice(start, selectionEnd)
    const out = block.replace(/^( {1,2}|\t)/gm, '')
    if (out === block) return
    const removedFirst = /^( {1,2}|\t)/.exec(block)?.[0].length ?? 0
    ta.setSelectionRange(start, selectionEnd)
    let ok = false
    try {
      ok = document.execCommand('insertText', false, out)
    } catch {
      ok = false
    }
    if (!ok) {
      ta.setRangeText(out, start, selectionEnd, 'end')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const newStart = Math.max(start, selectionStart - removedFirst)
    ta.setSelectionRange(newStart, start + out.length)
  }

  private enter(): void {
    const { container, editor } = this.opts
    const ta = this.ensureTextarea()
    const max = container.scrollHeight - container.clientHeight
    const ratio = max > 0 ? container.scrollTop / max : 0
    this.enterScrollTop = container.scrollTop

    const md = this.opts.getMarkdown()
    ta.value = md
    this.applied = md
    this.touched = false
    this.isActive = true
    container.classList.add('source-active')
    this.pill.classList.add('on')
    editor.on('update', this.onEditorUpdate)

    // Caret roughly where the user was looking; keep that part on screen.
    const caret = Math.min(md.length, Math.round(md.length * ratio))
    ta.focus({ preventScroll: true })
    const lineStart = md.lastIndexOf('\n', caret - 1) + 1
    ta.setSelectionRange(lineStart, lineStart)
    const tmax = ta.scrollHeight - ta.clientHeight
    ta.scrollTop = Math.round(Math.max(0, tmax) * ratio)
  }

  private exit(): void {
    const { container, editor } = this.opts
    const ta = this.ensureTextarea()
    const tmax = ta.scrollHeight - ta.clientHeight
    const ratio = tmax > 0 ? ta.scrollTop / tmax : 0

    // Apply any pending edits first (no-op when the text never changed).
    const changed = this.touched
    this.commit()
    editor.off('update', this.onEditorUpdate)
    this.isActive = false
    container.classList.remove('source-active')
    this.pill.classList.remove('on')

    const restore = (): void => {
      const max = container.scrollHeight - container.clientHeight
      container.scrollTop = changed ? Math.round(Math.max(0, max) * ratio) : this.enterScrollTop
    }
    restore()

    if (changed) {
      // setMarkdown parks the caret at the start; move it to what is on screen.
      try {
        const box = editor.view.dom.getBoundingClientRect()
        const top = container.getBoundingClientRect().top + 32
        const hit = editor.view.posAtCoords({ left: box.left + 24, top })
        if (hit) editor.commands.setTextSelection(hit.pos)
      } catch {
        // keep the default selection
      }
    }
    editor.commands.focus(null, { scrollIntoView: false })
    // Late layout (math, mermaid, images) can shift heights.
    requestAnimationFrame(restore)
  }
}
