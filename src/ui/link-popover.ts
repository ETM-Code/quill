// Link UI: click a link -> popover with the URL (click to open), edit, remove.
// Cmd+K -> create/edit link on the current selection.
import type { Editor } from '@tiptap/core'
import { icons } from '../icons'
import { Popover, selectionAnchor, elementAnchor, type AnchorRect } from './popover'

export class LinkPopover {
  private editor: Editor
  private openUrl: (url: string) => void
  private popover: Popover
  private mode: 'view' | 'edit' = 'view'

  // view mode elements
  private viewRow: HTMLDivElement
  private urlLabel: HTMLAnchorElement
  // edit mode elements
  private editRow: HTMLDivElement
  private input: HTMLInputElement

  constructor(editor: Editor, openUrl: (url: string) => void) {
    this.editor = editor
    this.openUrl = openUrl
    this.popover = new Popover({ className: 'link-popover' })

    // --- view mode: [url (click to open)] [edit] [remove] ---
    this.viewRow = document.createElement('div')
    this.viewRow.className = 'link-popover-row'

    this.urlLabel = document.createElement('a')
    this.urlLabel.className = 'link-popover-url'
    this.urlLabel.title = 'Open link'
    this.urlLabel.addEventListener('click', e => {
      e.preventDefault()
      const href = this.urlLabel.dataset.href
      if (href) this.openUrl(href)
      this.popover.hide()
    })

    const copyBtn = iconButton(icons.copy, 'Copy link')
    copyBtn.addEventListener('click', () => {
      const href = this.urlLabel.dataset.href
      if (!href) return
      void navigator.clipboard.writeText(href).then(() => {
        copyBtn.innerHTML = icons.check
        setTimeout(() => {
          copyBtn.innerHTML = icons.copy
        }, 1000)
      })
    })

    const editBtn = iconButton(icons.pencil, 'Edit link')
    editBtn.addEventListener('click', () => this.switchToEdit())

    const removeBtn = iconButton(icons.unlink, 'Remove link')
    removeBtn.addEventListener('click', () => {
      this.editor.chain().focus().extendMarkRange('link').unsetLink().run()
      this.popover.hide()
    })

    this.viewRow.append(this.urlLabel, copyBtn, editBtn, removeBtn)

    // --- edit mode: [input] [✓] ---
    this.editRow = document.createElement('div')
    this.editRow.className = 'link-popover-row'

    this.input = document.createElement('input')
    this.input.className = 'link-popover-input'
    this.input.type = 'text'
    this.input.placeholder = 'Paste or type a link…'
    this.input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        this.commit()
      }
    })

    const applyBtn = iconButton(icons.check, 'Apply')
    applyBtn.addEventListener('click', () => this.commit())

    this.editRow.append(this.input, applyBtn)
    this.popover.el.append(this.viewRow, this.editRow)
  }

  /** Show view-mode popover for a clicked link */
  showForLink(anchor: HTMLAnchorElement): void {
    const href = anchor.getAttribute('href') ?? ''
    this.mode = 'view'
    this.urlLabel.textContent = displayUrl(href)
    this.urlLabel.dataset.href = href
    this.applyMode()
    this.popover.show(elementAnchor(anchor))
  }

  /** Cmd+K / bubble-menu entry: edit link on current selection */
  showEditor(): void {
    const { state } = this.editor
    if (state.selection.empty && !this.editor.isActive('link')) return

    if (this.editor.isActive('link')) {
      this.editor.chain().extendMarkRange('link').run()
    }
    const { from, to } = this.editor.state.selection
    this.mode = 'edit'
    this.input.value = (this.editor.getAttributes('link').href as string | undefined) ?? ''
    this.applyMode()
    this.popover.show(selectionAnchor(this.editor.view, from, to))
    this.focusInput()
  }

  /** The popover becomes visible on the next frame; focus after that. */
  private focusInput(): void {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.input.focus()
        this.input.select()
      })
    })
  }

  private switchToEdit(): void {
    this.mode = 'edit'
    this.input.value = this.urlLabel.dataset.href ?? ''
    this.applyMode()
    this.popover.reposition()
    this.focusInput()
  }

  private applyMode(): void {
    this.viewRow.style.display = this.mode === 'view' ? 'flex' : 'none'
    this.editRow.style.display = this.mode === 'edit' ? 'flex' : 'none'
  }

  private commit(): void {
    const raw = this.input.value.trim()
    const chain = this.editor.chain().focus().extendMarkRange('link')
    if (!raw) {
      chain.unsetLink().run()
    } else {
      const href = /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('/') || raw.startsWith('#')
        ? raw
        : `https://${raw}`
      chain.setLink({ href }).run()
    }
    this.popover.hide()
  }

  hide(): void {
    this.popover.hide()
  }

  get isVisible(): boolean {
    return this.popover.isVisible
  }

  reposition(anchor?: AnchorRect): void {
    this.popover.reposition(anchor)
  }
}

function iconButton(svg: string, title: string): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'popover-icon-btn'
  btn.title = title
  btn.innerHTML = svg
  return btn
}

function displayUrl(href: string): string {
  try {
    const url = new URL(href)
    const path = url.pathname === '/' ? '' : url.pathname
    const display = `${url.hostname}${path}`
    return display.length > 42 ? `${display.slice(0, 40)}…` : display
  } catch {
    return href.length > 42 ? `${href.slice(0, 40)}…` : href
  }
}
