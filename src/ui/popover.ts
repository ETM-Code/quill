// Shared floating panel: positioning, dismissal, one-at-a-time management.

export interface AnchorRect {
  left: number
  top: number
  right: number
  bottom: number
}

interface PopoverOptions {
  className?: string
  /** Place above the anchor instead of below */
  preferAbove?: boolean
  /** Horizontal alignment relative to the anchor (default: center) */
  align?: 'center' | 'start'
  /** Called after the popover is dismissed (Escape, outside click, hide()) */
  onHide?: () => void
  /** Don't auto-hide when clicking inside the editor */
  sticky?: boolean
}

const openPopovers = new Set<Popover>()

export function hideAllPopovers(except?: Popover): void {
  for (const p of [...openPopovers]) {
    if (p !== except) p.hide()
  }
}

export class Popover {
  readonly el: HTMLDivElement
  private opts: PopoverOptions
  private visible = false
  private anchor: AnchorRect | null = null
  private onDocPointerDown = (e: PointerEvent) => {
    if (!this.el.contains(e.target as Node)) this.hide()
  }
  private onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      this.hide()
    }
  }

  constructor(opts: PopoverOptions = {}) {
    this.opts = opts
    this.el = document.createElement('div')
    this.el.className = `popover ${opts.className ?? ''}`.trim()
    this.el.style.position = 'fixed'
    this.el.style.visibility = 'hidden'
    this.el.style.zIndex = '1000'
    document.body.appendChild(this.el)
  }

  get isVisible(): boolean {
    return this.visible
  }

  show(anchor: AnchorRect): void {
    hideAllPopovers(this)
    this.anchor = anchor
    this.visible = true
    openPopovers.add(this)
    this.el.style.visibility = 'hidden'
    this.el.style.display = ''
    // Position after layout so we know our own size
    requestAnimationFrame(() => {
      if (!this.visible || !this.anchor) return
      this.position(this.anchor)
      this.el.style.visibility = 'visible'
    })
    // Defer listeners so the triggering click doesn't immediately dismiss
    setTimeout(() => {
      if (!this.visible) return
      document.addEventListener('pointerdown', this.onDocPointerDown, true)
      document.addEventListener('keydown', this.onKeyDown, true)
    }, 0)
  }

  reposition(anchor?: AnchorRect): void {
    if (anchor) this.anchor = anchor
    if (this.visible && this.anchor) this.position(this.anchor)
  }

  private position(anchor: AnchorRect): void {
    const margin = 8
    const rect = this.el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    let left = this.opts.align === 'start'
      ? anchor.left
      : anchor.left + (anchor.right - anchor.left) / 2 - rect.width / 2
    left = Math.max(margin, Math.min(left, vw - rect.width - margin))

    let top: number
    if (this.opts.preferAbove) {
      top = anchor.top - rect.height - margin
      if (top < margin) top = anchor.bottom + margin
    } else {
      top = anchor.bottom + margin
      if (top + rect.height > vh - margin) top = anchor.top - rect.height - margin
    }
    top = Math.max(margin, Math.min(top, vh - rect.height - margin))

    this.el.style.left = `${Math.round(left)}px`
    this.el.style.top = `${Math.round(top)}px`
  }

  hide(): void {
    if (!this.visible) return
    this.visible = false
    openPopovers.delete(this)
    this.el.style.display = 'none'
    document.removeEventListener('pointerdown', this.onDocPointerDown, true)
    document.removeEventListener('keydown', this.onKeyDown, true)
    this.opts.onHide?.()
  }

  destroy(): void {
    this.hide()
    this.el.remove()
  }
}

/** Anchor rect for the current editor selection */
export function selectionAnchor(view: { coordsAtPos: (pos: number) => { left: number; top: number; right: number; bottom: number } }, from: number, to: number): AnchorRect {
  const start = view.coordsAtPos(from)
  const end = view.coordsAtPos(to)
  return {
    left: Math.min(start.left, end.left),
    top: Math.min(start.top, end.top),
    right: Math.max(start.right, end.right),
    bottom: Math.max(start.bottom, end.bottom),
  }
}

export function elementAnchor(el: Element): AnchorRect {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
}
