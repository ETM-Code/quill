// Table UI chrome: toolbar icons and the hover "+" bars that append a row or
// column. The bars are plain elements on document.body positioned from the
// table's DOM rect: nothing here touches ProseMirror-managed DOM, and no layout
// is read unless the pointer is over a table.
import type { EditorView } from '@tiptap/pm/view'
import './table-controls.css'

function svg(paths: string): string {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
}

export const tableIcons = {
  alignLeft: svg('<line x1="21" y1="6" x2="3" y2="6"/><line x1="15" y1="12" x2="3" y2="12"/><line x1="17" y1="18" x2="3" y2="18"/>'),
  alignCenter: svg('<line x1="21" y1="6" x2="3" y2="6"/><line x1="17" y1="12" x2="7" y2="12"/><line x1="19" y1="18" x2="5" y2="18"/>'),
  alignRight: svg('<line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="12" x2="9" y2="12"/><line x1="21" y1="18" x2="7" y2="18"/>'),
  moveUp: svg('<path d="m18 9-6-6-6 6"/><path d="M12 3v14"/><path d="M5 21h14"/>'),
  moveDown: svg('<path d="M19 3H5"/><path d="M12 21V7"/><path d="m6 15 6 6 6-6"/>'),
  moveLeft: svg('<path d="m9 6-6 6 6 6"/><path d="M3 12h14"/><path d="M21 19V5"/>'),
  moveRight: svg('<path d="M17 12H3"/><path d="m11 18 6-6-6-6"/><path d="M21 5v14"/>'),
  plus: svg('<path d="M12 5v14"/><path d="M5 12h14"/>'),
} as const

export interface TableHoverActions {
  addRow(tableEl: Element): void
  addColumn(tableEl: Element): void
}

const HIDE_DELAY = 220

export class TableHoverControls {
  private rowBar: HTMLDivElement
  private colBar: HTMLDivElement
  private table: HTMLElement | null = null
  private hideTimer = 0
  private raf = 0
  private container: HTMLElement

  constructor(private view: EditorView, private actions: TableHoverActions) {
    this.rowBar = this.makeBar('row', 'Add row')
    this.colBar = this.makeBar('col', 'Add column')
    document.body.append(this.rowBar, this.colBar)
    this.container = document.getElementById('editor-container') ?? view.dom.parentElement ?? view.dom
    this.container.addEventListener('mousemove', this.onMove, { passive: true })
    this.container.addEventListener('mouseleave', this.scheduleHide)
    this.container.addEventListener('scroll', this.onScroll, { passive: true })
    window.addEventListener('resize', this.onScroll)
  }

  private makeBar(kind: 'row' | 'col', label: string): HTMLDivElement {
    const bar = document.createElement('div')
    bar.className = `tbl-hover tbl-hover-${kind}`
    bar.hidden = true
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'tbl-hover-btn'
    btn.title = label
    btn.setAttribute('aria-label', label)
    btn.innerHTML = tableIcons.plus
    // Keep the editor selection/focus while clicking the bar.
    bar.addEventListener('mousedown', e => e.preventDefault())
    bar.addEventListener('mouseenter', () => window.clearTimeout(this.hideTimer))
    bar.addEventListener('mouseleave', this.scheduleHide)
    bar.addEventListener('click', () => {
      const t = this.table
      if (!t || !t.isConnected) return
      if (kind === 'row') this.actions.addRow(t)
      else this.actions.addColumn(t)
      this.schedulePosition()
    })
    bar.appendChild(btn)
    return bar
  }

  private onMove = (e: MouseEvent): void => {
    if (e.buttons !== 0 || !this.view.editable) {
      this.hide()
      return
    }
    const target = e.target as Element | null
    const table = target?.closest?.('table') as HTMLElement | null
    if (table && this.view.dom.contains(table)) {
      window.clearTimeout(this.hideTimer)
      if (table !== this.table) this.show(table)
    } else if (this.table) {
      this.scheduleHide()
    }
  }

  private scheduleHide = (): void => {
    if (!this.table) return
    window.clearTimeout(this.hideTimer)
    this.hideTimer = window.setTimeout(() => this.hide(), HIDE_DELAY)
  }

  private onScroll = (): void => {
    if (this.table) this.schedulePosition()
  }

  /** Called from the plugin view's update(): only does work while a bar is up. */
  refresh(): void {
    if (this.table) this.schedulePosition()
  }

  private schedulePosition(): void {
    cancelAnimationFrame(this.raf)
    this.raf = requestAnimationFrame(() => {
      const t = this.table
      if (!t) return
      if (!t.isConnected) this.hide()
      else this.position(t)
    })
  }

  private show(table: HTMLElement): void {
    this.table = table
    this.position(table)
  }

  private position(table: HTMLElement): void {
    const t = table.getBoundingClientRect()
    const wrap = (table.closest('.tableWrapper') as HTMLElement | null)?.getBoundingClientRect()
    const clipTop = this.container.getBoundingClientRect()
    const left = Math.max(t.left, wrap?.left ?? t.left)
    const right = Math.min(t.right, wrap?.right ?? t.right)
    const tableFullyRight = !wrap || t.right <= wrap.right + 1

    const rowVisible = t.bottom > clipTop.top && t.bottom < clipTop.bottom - 4 && right > left
    this.rowBar.hidden = !rowVisible
    if (rowVisible) {
      this.rowBar.style.left = `${Math.round(left)}px`
      this.rowBar.style.width = `${Math.round(right - left)}px`
      this.rowBar.style.top = `${Math.round(t.bottom + 3)}px`
    }

    const top = Math.max(t.top, clipTop.top)
    const bottom = Math.min(t.bottom, clipTop.bottom)
    const colVisible = tableFullyRight && bottom > top
    this.colBar.hidden = !colVisible
    if (colVisible) {
      this.colBar.style.left = `${Math.round(right + 3)}px`
      this.colBar.style.top = `${Math.round(top)}px`
      this.colBar.style.height = `${Math.round(bottom - top)}px`
    }
  }

  hide(): void {
    window.clearTimeout(this.hideTimer)
    cancelAnimationFrame(this.raf)
    this.table = null
    this.rowBar.hidden = true
    this.colBar.hidden = true
  }

  destroy(): void {
    this.hide()
    this.container.removeEventListener('mousemove', this.onMove)
    this.container.removeEventListener('mouseleave', this.scheduleHide)
    this.container.removeEventListener('scroll', this.onScroll)
    window.removeEventListener('resize', this.onScroll)
    this.rowBar.remove()
    this.colBar.remove()
  }
}
