// Image popover: shown when an image is clicked.
//   [ alt text ............................ ]
//   [open] [reveal] [copy path] | S M L Auto | [delete]
import type { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { icons } from '../icons'
import { Popover, elementAnchor } from './popover'

export interface ImagePopoverActions {
  /** Open the image (Preview for local files, browser for remote) */
  open: (src: string) => void
  /** Reveal a local file in Finder */
  reveal: (absPath: string) => void
  /** Absolute path for a local src, null for remote/data/unsaved-relative */
  localPath: (src: string) => string | null
}

const SIZES: Array<[label: string, width: number | null, title: string]> = [
  ['S', 240, 'Small (240px)'],
  ['M', 420, 'Medium (420px)'],
  ['L', 640, 'Large (640px)'],
  ['Auto', null, 'Natural size'],
]

export class ImagePopover {
  private editor: Editor
  private actions: ImagePopoverActions
  private popover: Popover
  private pos: number | null = null
  private alt: HTMLInputElement
  private openBtn: HTMLButtonElement
  private revealBtn: HTMLButtonElement
  private copyBtn: HTMLButtonElement
  private sizeBtns: HTMLButtonElement[] = []

  constructor(editor: Editor, actions: ImagePopoverActions) {
    this.editor = editor
    this.actions = actions
    this.popover = new Popover({ className: 'image-popover', onHide: () => this.commitAlt() })

    this.alt = document.createElement('input')
    this.alt.type = 'text'
    this.alt.className = 'image-popover-alt'
    this.alt.placeholder = 'Alt text (describe the image)'
    this.alt.spellcheck = true
    this.alt.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        this.commitAlt()
        this.popover.hide()
        this.editor.commands.focus()
      }
    })
    this.alt.addEventListener('blur', () => this.commitAlt())

    const row = document.createElement('div')
    row.className = 'image-popover-row'

    this.openBtn = button(icons.externalLink, 'Open image')
    this.openBtn.addEventListener('click', () => {
      const src = this.node()?.attrs.src as string | undefined
      this.popover.hide()
      if (src) this.actions.open(src)
    })
    this.revealBtn = button(icons.folder, 'Show in Finder')
    this.revealBtn.addEventListener('click', () => {
      const src = this.node()?.attrs.src as string | undefined
      const abs = src ? this.actions.localPath(src) : null
      this.popover.hide()
      if (abs) this.actions.reveal(abs)
    })
    this.copyBtn = button(icons.copy, 'Copy image path')
    this.copyBtn.addEventListener('click', () => {
      const src = (this.node()?.attrs.src as string | undefined) ?? ''
      const text = this.actions.localPath(src) ?? src
      void navigator.clipboard.writeText(text).then(() => {
        this.copyBtn.innerHTML = icons.check
        setTimeout(() => (this.copyBtn.innerHTML = icons.copy), 1000)
      })
    })

    const sizes = document.createElement('div')
    sizes.className = 'image-popover-sizes'
    sizes.setAttribute('role', 'group')
    sizes.setAttribute('aria-label', 'Image size')
    for (const [label, width, title] of SIZES) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'image-popover-size'
      b.textContent = label
      b.title = title
      b.dataset.width = width == null ? '' : String(width)
      b.addEventListener('click', () => this.setWidth(width))
      this.sizeBtns.push(b)
      sizes.appendChild(b)
    }

    const del = button(icons.trash, 'Delete image')
    del.classList.add('danger')
    del.addEventListener('click', () => {
      const pos = this.pos
      this.pos = null
      this.popover.hide()
      if (pos == null || !this.nodeAt(pos)) return
      this.editor.chain().focus().deleteRange({ from: pos, to: pos + 1 }).run()
    })

    row.append(this.openBtn, this.revealBtn, this.copyBtn, divider(), sizes, divider(), del)
    this.popover.el.append(this.alt, row)
  }

  get isVisible(): boolean {
    return this.popover.isVisible
  }

  private nodeAt(pos: number) {
    const node = this.editor.state.doc.nodeAt(pos)
    return node?.type.name === 'image' ? node : null
  }

  private node() {
    return this.pos == null ? null : this.nodeAt(this.pos)
  }

  show(pos: number, dom: HTMLElement): void {
    const node = this.nodeAt(pos)
    if (!node) return
    this.pos = pos
    const src = (node.attrs.src as string) ?? ''
    this.alt.value = (node.attrs.alt as string | null) ?? ''
    const local = this.actions.localPath(src)
    this.revealBtn.style.display = local ? '' : 'none'
    this.openBtn.disabled = !src || src.startsWith('data:')
    this.openBtn.title = local ? 'Open in Preview' : 'Open in browser'
    this.syncSizes(node.attrs.width)
    this.popover.show(elementAnchor(dom))
  }

  hide(): void {
    this.popover.hide()
  }

  private syncSizes(width: unknown): void {
    const w = width == null || width === '' ? '' : String(Number.parseInt(String(width), 10))
    for (const b of this.sizeBtns) b.classList.toggle('active', b.dataset.width === w)
  }

  private update(attrs: Record<string, unknown>): void {
    const pos = this.pos
    const node = pos == null ? null : this.nodeAt(pos)
    if (pos == null || !node) return
    const tr = this.editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs })
    tr.setSelection(NodeSelection.create(tr.doc, pos))
    this.editor.view.dispatch(tr)
  }

  private commitAlt(): void {
    const node = this.node()
    if (!node) return
    const alt = this.alt.value.trim() || null
    if (alt !== (node.attrs.alt ?? null)) this.update({ alt })
  }

  private setWidth(width: number | null): void {
    this.update({ width, height: null })
    this.syncSizes(width)
    const dom = this.pos == null ? null : (this.editor.view.nodeDOM(this.pos) as HTMLElement | null)
    if (dom) requestAnimationFrame(() => this.popover.reposition(elementAnchor(dom)))
  }
}

function button(svg: string, title: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'popover-icon-btn'
  b.title = title
  b.setAttribute('aria-label', title)
  b.innerHTML = svg
  return b
}

function divider(): HTMLDivElement {
  const d = document.createElement('div')
  d.className = 'popover-divider'
  return d
}
