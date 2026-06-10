// Inline LaTeX editor with live preview, replacing the old native prompt().
import type { Editor } from '@tiptap/core'
import { Popover, type AnchorRect } from './popover'

type MathKind = 'inline' | 'block'

export class MathPopover {
  private editor: Editor
  private popover: Popover
  private textarea: HTMLTextAreaElement
  private preview: HTMLDivElement
  private hint: HTMLDivElement
  private kind: MathKind = 'inline'
  private pos = 0
  private katexRender: ((latex: string, el: HTMLElement) => void) | null = null

  constructor(editor: Editor) {
    this.editor = editor
    this.popover = new Popover({ className: 'math-popover' })

    this.textarea = document.createElement('textarea')
    this.textarea.className = 'math-popover-input'
    this.textarea.rows = 1
    this.textarea.placeholder = 'E = mc^2'
    this.textarea.spellcheck = false
    this.textarea.addEventListener('input', () => {
      this.autosize()
      this.renderPreview()
    })
    this.textarea.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
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
    this.preview.className = 'math-popover-preview'

    this.hint = document.createElement('div')
    this.hint.className = 'math-popover-hint'
    this.hint.textContent = 'Enter to save · Esc to cancel · empty to delete'

    this.popover.el.append(this.textarea, this.preview, this.hint)

    void import('katex').then(katex => {
      this.katexRender = (latex, el) => {
        katex.default.render(latex, el, { throwOnError: false, displayMode: this.kind === 'block' })
      }
      if (this.popover.isVisible) this.renderPreview()
    })
  }

  show(kind: MathKind, latex: string, pos: number, anchor: AnchorRect): void {
    this.kind = kind
    this.pos = pos
    this.textarea.value = latex
    this.popover.show(anchor)
    this.autosize()
    this.renderPreview()
    // Popover.show reveals the panel on the next frame; a hidden element
    // silently refuses focus, so wait two frames before grabbing it.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.textarea.focus()
        this.textarea.select()
      })
    })
  }

  private autosize(): void {
    this.textarea.style.height = 'auto'
    this.textarea.style.height = `${Math.min(this.textarea.scrollHeight, 180)}px`
  }

  private renderPreview(): void {
    const latex = this.textarea.value.trim()
    if (!latex) {
      this.preview.textContent = ''
      return
    }
    if (this.katexRender) {
      this.katexRender(latex, this.preview)
    } else {
      this.preview.textContent = latex
    }
    this.popover.reposition()
  }

  private commit(): void {
    const latex = this.textarea.value.trim()
    if (!latex) {
      this.editor.chain().setNodeSelection(this.pos).deleteSelection().focus().run()
    } else if (this.kind === 'inline') {
      // pos must be explicit: update*Math reads the live editor selection,
      // not the chained one.
      this.editor.chain().updateInlineMath({ latex, pos: this.pos } as never).focus().run()
    } else {
      this.editor.chain().updateBlockMath({ latex, pos: this.pos } as never).focus().run()
    }
    this.popover.hide()
  }

  hide(): void {
    this.popover.hide()
  }
}
