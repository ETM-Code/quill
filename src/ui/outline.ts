// Outline / table of contents sidebar (⇧⌘O).
import type { Editor } from '@tiptap/core'
import { collectHeadings, type HeadingInfo } from '../extensions/heading-ids'
import { exitSourceMode } from './source-view'
import './views.css'

const STORAGE_KEY = 'quill.outline.visible'
const REFRESH_DELAY_MS = 250
/** A heading counts as "current" once its top is within this many px of the viewport top. */
const ACTIVE_OFFSET_PX = 40

const OUTLINE_ICON =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="9" y1="18" x2="21" y2="18"/>' +
  '<line x1="3" y1="12" x2="4" y2="12"/><line x1="3" y1="18" x2="4" y2="18"/></svg>'

function readPref(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writePref(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0')
  } catch {
    // storage unavailable: preference just isn't remembered
  }
}

export class Outline {
  private isVisible = false
  private nav: HTMLElement | null = null
  private list: HTMLElement | null = null
  private button: HTMLButtonElement
  private container: HTMLElement | null
  private headings: HeadingInfo[] = []
  private signature: string | null = null
  private items: HTMLButtonElement[] = []
  private activeIndex = -1
  private refreshTimer: ReturnType<typeof setTimeout> | undefined
  private scrollRaf = 0

  private onUpdate = () => {
    clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => this.refresh(), REFRESH_DELAY_MS)
  }
  private onScroll = () => {
    if (this.scrollRaf) return
    this.scrollRaf = requestAnimationFrame(() => {
      this.scrollRaf = 0
      this.updateActive()
    })
  }

  constructor(private editor: Editor) {
    this.container = document.getElementById('editor-container')

    this.button = document.createElement('button')
    this.button.type = 'button'
    this.button.className = 'titlebar-btn outline-toggle'
    this.button.title = 'Outline (⇧⌘O)'
    this.button.setAttribute('aria-label', 'Toggle outline')
    this.button.setAttribute('aria-pressed', 'false')
    this.button.innerHTML = OUTLINE_ICON
    // Don't let the titlebar start a window drag from the button.
    this.button.addEventListener('mousedown', e => e.stopPropagation())
    this.button.addEventListener('click', () => this.toggle())
    document.querySelector('.titlebar-right')?.appendChild(this.button)

    if (readPref()) this.show(false)
  }

  get visible(): boolean {
    return this.isVisible
  }

  toggle(): void {
    if (this.isVisible) this.hide()
    else this.show(true)
  }

  private show(persist: boolean): void {
    if (this.isVisible) return
    this.ensureDom()
    this.isVisible = true
    this.nav!.classList.add('on')
    this.container?.classList.add('has-outline')
    this.button.setAttribute('aria-pressed', 'true')
    if (persist) writePref(true)
    this.editor.on('update', this.onUpdate)
    this.container?.addEventListener('scroll', this.onScroll, { passive: true })
    this.refresh()
  }

  private hide(): void {
    if (!this.isVisible) return
    this.isVisible = false
    this.nav?.classList.remove('on')
    this.container?.classList.remove('has-outline')
    this.button.setAttribute('aria-pressed', 'false')
    writePref(false)
    this.editor.off('update', this.onUpdate)
    this.container?.removeEventListener('scroll', this.onScroll)
    clearTimeout(this.refreshTimer)
    cancelAnimationFrame(this.scrollRaf)
    this.scrollRaf = 0
  }

  private ensureDom(): void {
    if (this.nav) return
    const nav = document.createElement('nav')
    nav.className = 'outline'
    nav.id = 'outline'
    nav.setAttribute('aria-label', 'Outline')
    const title = document.createElement('div')
    title.className = 'outline-title'
    title.textContent = 'Outline'
    const list = document.createElement('div')
    list.className = 'outline-list'
    nav.append(title, list)
    list.addEventListener('click', e => {
      const item = (e.target as HTMLElement).closest<HTMLButtonElement>('.outline-item')
      if (item) this.goTo(Number(item.dataset.index))
    })
    // Keep focus where it is when pressing items (no caret flash in the editor).
    list.addEventListener('mousedown', e => {
      if ((e.target as HTMLElement).closest('.outline-item')) e.preventDefault()
    })
    ;(document.getElementById('app') ?? document.body).appendChild(nav)
    this.nav = nav
    this.list = list
  }

  /** Re-read headings; only touches the DOM when the list of headings changed. */
  private refresh(): void {
    if (!this.isVisible || !this.list) return
    const headings = collectHeadings(this.editor.state.doc)
    this.headings = headings
    const signature = headings.map(h => `${h.level}:${h.text}`).join('\n')
    if (signature !== this.signature) {
      this.signature = signature
      this.render()
    }
    this.updateActive()
  }

  private render(): void {
    const list = this.list!
    list.textContent = ''
    this.items = []
    this.activeIndex = -1
    if (this.headings.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'outline-empty'
      empty.textContent = 'No headings'
      list.appendChild(empty)
      return
    }
    const frag = document.createDocumentFragment()
    this.headings.forEach((h, i) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'outline-item'
      b.dataset.index = String(i)
      b.dataset.level = String(h.level)
      b.style.setProperty('--lvl', String(h.level))
      const label = h.text.trim() || 'Untitled'
      b.textContent = label
      b.title = label
      frag.appendChild(b)
      this.items.push(b)
    })
    list.appendChild(frag)
  }

  private headingDom(h: HeadingInfo): HTMLElement | null {
    try {
      const dom = this.editor.view.nodeDOM(h.pos)
      return dom instanceof HTMLElement ? dom : null
    } catch {
      return null
    }
  }

  /** Highlight the last heading whose top has scrolled to (or past) the viewport top. */
  private updateActive(): void {
    // Hidden editor (source mode) has no layout: keep the current highlight.
    if (!this.isVisible || !this.container || this.container.classList.contains('source-active')) return
    let idx = -1
    const limit = this.container.getBoundingClientRect().top + ACTIVE_OFFSET_PX
    for (let i = 0; i < this.headings.length; i++) {
      const dom = this.headingDom(this.headings[i])
      if (!dom) continue
      if (dom.getBoundingClientRect().top <= limit) idx = i
      else break
    }
    this.setActive(idx)
  }

  private setActive(idx: number): void {
    if (idx === this.activeIndex) return
    this.items[this.activeIndex]?.classList.remove('active')
    this.activeIndex = idx
    const item = this.items[idx]
    if (!item || !this.list) return
    item.classList.add('active')
    // Keep the highlighted entry visible in the (possibly scrolled) sidebar.
    const l = this.list.getBoundingClientRect()
    const r = item.getBoundingClientRect()
    if (r.top < l.top) this.list.scrollTop -= l.top - r.top + 8
    else if (r.bottom > l.bottom) this.list.scrollTop += r.bottom - l.bottom + 8
  }

  private goTo(index: number): void {
    // Source mode hides the editor: return to it first.
    exitSourceMode()
    const heading = this.headings[index]
    if (!heading) return
    this.editor.chain().setTextSelection(heading.pos + 1).focus(undefined, { scrollIntoView: false }).run()
    const dom = this.headingDom(heading)
    if (dom) dom.scrollIntoView({ block: 'start' })
    this.setActive(index)
  }
}
