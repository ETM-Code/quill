// Mermaid diagram editor popover: click a diagram block to open a multiline
// textarea with live re-render preview. Mirrors the MathPopover pattern.
import type { Editor } from '@tiptap/core'
import { Popover, type AnchorRect } from './popover'
import { updateMermaidCode } from '../mermaid'

type MermaidModule = typeof import('mermaid')

let mermaidCache: MermaidModule | null = null
let mermaidLoad: Promise<MermaidModule> | null = null
let previewCounter = 0

async function loadMermaid(): Promise<MermaidModule> {
  if (mermaidCache) return mermaidCache
  if (!mermaidLoad) {
    mermaidLoad = import('mermaid').then(m => {
      mermaidCache = m
      return m
    })
  }
  return mermaidLoad
}

export class MermaidPopover {
  private editor: Editor
  private popover: Popover
  private textarea: HTMLTextAreaElement
  private preview: HTMLDivElement
  private hint: HTMLDivElement
  private pos = 0

  constructor(editor: Editor) {
    this.editor = editor
    this.popover = new Popover({ className: 'mermaid-popover' })

    this.textarea = document.createElement('textarea')
    this.textarea.className = 'mermaid-popover-input'
    this.textarea.rows = 4
    this.textarea.placeholder = 'graph TD\n  A[Start] --> B[End]'
    this.textarea.spellcheck = false
    this.textarea.addEventListener('input', () => {
      this.autosize()
      void this.renderPreview()
    })
    this.textarea.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        // Cmd/Ctrl+Enter commits (plain Enter is a newline in multiline source).
        e.preventDefault()
        e.stopPropagation()
        this.commit()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        this.popover.hide()
        this.editor.commands.focus()
      }
    })

    this.preview = document.createElement('div')
    this.preview.className = 'mermaid-popover-preview'

    this.hint = document.createElement('div')
    this.hint.className = 'mermaid-popover-hint'
    this.hint.textContent = 'Cmd+Enter to save · Esc to cancel'

    this.popover.el.append(this.textarea, this.preview, this.hint)

    // Kick off mermaid load eagerly so the preview is snappy.
    void loadMermaid()
  }

  show(code: string, pos: number, anchor: AnchorRect): void {
    this.pos = pos
    this.textarea.value = code
    this.popover.show(anchor)
    this.autosize()
    void this.renderPreview()
    // Popover.show reveals on the next frame; wait two frames before grabbing focus.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.textarea.focus()
        this.textarea.select()
      })
    })
  }

  private autosize(): void {
    this.textarea.style.height = 'auto'
    this.textarea.style.height = `${Math.min(this.textarea.scrollHeight, 240)}px`
  }

  private async renderPreview(): Promise<void> {
    const code = this.textarea.value.trim()
    if (!code) {
      this.preview.innerHTML = ''
      this.popover.reposition()
      return
    }
    try {
      const mermaid = await loadMermaid()
      const id = `mermaid-popover-${++previewCounter}`
      const { svg } = await mermaid.default.render(id, code)
      const { default: DOMPurify } = await import('dompurify')
      const clean = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } })
      // Only update if the textarea still has the same content (not superseded).
      if (code === this.textarea.value.trim()) {
        this.preview.innerHTML = clean
        this.popover.reposition()
      }
    } catch {
      // Invalid syntax: clear the preview quietly (the main block shows error state).
      this.preview.innerHTML = ''
      this.popover.reposition()
    }
  }

  private commit(): void {
    const code = this.textarea.value.trim()
    if (code) {
      updateMermaidCode(this.editor as never, this.pos, code)
    } else {
      // Empty source -> delete the node.
      this.editor.chain().setNodeSelection(this.pos).deleteSelection().focus().run()
    }
    this.popover.hide()
    this.editor.commands.focus()
  }

  hide(): void {
    this.popover.hide()
  }
}
