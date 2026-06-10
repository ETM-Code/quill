// Find & replace bar (Cmd+F / Cmd+Option+F), with match highlighting.
import type { Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { icons } from '../icons'

interface Match {
  from: number
  to: number
}

const findKey = new PluginKey<{ matches: Match[]; current: number }>('quill-find')

function findMatches(doc: import('@tiptap/pm/model').Node, query: string): Match[] {
  if (!query) return []
  const matches: Match[] = []
  const needle = query.toLowerCase()

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    // Build the block's text with per-character document positions
    let text = ''
    const positions: number[] = []
    node.descendants((child, childPos) => {
      if (child.isText && child.text) {
        for (let i = 0; i < child.text.length; i++) {
          positions.push(pos + 1 + childPos + i)
        }
        text += child.text
      } else if (child.isLeaf) {
        positions.push(pos + 1 + childPos)
        text += '￼'
      }
      return true
    })
    const haystack = text.toLowerCase()
    let idx = haystack.indexOf(needle)
    while (idx !== -1) {
      matches.push({ from: positions[idx], to: positions[idx + needle.length - 1] + 1 })
      idx = haystack.indexOf(needle, idx + 1)
    }
    return false
  })
  return matches
}

export class FindBar {
  private editor: Editor
  private el: HTMLDivElement
  private findInput: HTMLInputElement
  private replaceInput: HTMLInputElement
  private replaceRow: HTMLDivElement
  private countEl: HTMLSpanElement
  private matches: Match[] = []
  private current = -1
  private visible = false
  private debounceId: ReturnType<typeof setTimeout> | undefined

  constructor(editor: Editor) {
    this.editor = editor
    editor.registerPlugin(
      new Plugin({
        key: findKey,
        state: {
          init: () => ({ matches: [] as Match[], current: -1 }),
          apply: (tr, value) => {
            const meta = tr.getMeta(findKey)
            if (meta) return meta
            if (!tr.docChanged) return value
            return {
              matches: value.matches.map(m => ({ from: tr.mapping.map(m.from), to: tr.mapping.map(m.to) })),
              current: value.current,
            }
          },
        },
        props: {
          decorations: state => {
            const value = findKey.getState(state)
            if (!value || value.matches.length === 0) return DecorationSet.empty
            return DecorationSet.create(
              state.doc,
              value.matches.map((m, i) =>
                Decoration.inline(m.from, m.to, {
                  class: i === value.current ? 'find-match find-match-current' : 'find-match',
                }),
              ),
            )
          },
        },
      }),
    )

    this.el = document.createElement('div')
    this.el.className = 'find-bar'
    this.el.style.display = 'none'

    const findRow = document.createElement('div')
    findRow.className = 'find-bar-row'

    this.findInput = document.createElement('input')
    this.findInput.className = 'find-bar-input'
    this.findInput.placeholder = 'Find'
    this.findInput.addEventListener('input', () => {
      clearTimeout(this.debounceId)
      this.debounceId = setTimeout(() => this.search(), 120)
    })
    this.findInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        this.step(e.shiftKey ? -1 : 1)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        this.hide()
      }
    })

    this.countEl = document.createElement('span')
    this.countEl.className = 'find-bar-count'

    const prevBtn = this.button(icons.arrowUp, 'Previous match', () => this.step(-1))
    const nextBtn = this.button(icons.arrowDown, 'Next match', () => this.step(1))
    const closeBtn = this.button(icons.close, 'Close (Esc)', () => this.hide())

    findRow.append(this.findInput, this.countEl, prevBtn, nextBtn, closeBtn)

    this.replaceRow = document.createElement('div')
    this.replaceRow.className = 'find-bar-row'
    this.replaceRow.style.display = 'none'

    this.replaceInput = document.createElement('input')
    this.replaceInput.className = 'find-bar-input'
    this.replaceInput.placeholder = 'Replace with'
    this.replaceInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        this.replaceCurrent()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        this.hide()
      }
    })

    const replaceBtn = textButton('Replace', () => this.replaceCurrent())
    const replaceAllBtn = textButton('Replace All', () => this.replaceAll())
    this.replaceRow.append(this.replaceInput, replaceBtn, replaceAllBtn)

    this.el.append(findRow, this.replaceRow)
    document.body.appendChild(this.el)
  }

  private button(svg: string, title: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'popover-icon-btn'
    btn.title = title
    btn.innerHTML = svg
    btn.addEventListener('click', onClick)
    return btn
  }

  show(withReplace: boolean): void {
    this.visible = true
    this.el.style.display = ''
    this.replaceRow.style.display = withReplace ? '' : 'none'
    // Pre-fill from selection
    const { from, to, empty } = this.editor.state.selection
    if (!empty && to - from < 80) {
      const text = this.editor.state.doc.textBetween(from, to)
      if (text && !text.includes('\n')) this.findInput.value = text
    }
    this.findInput.focus()
    this.findInput.select()
    this.search()
  }

  toggleReplace(): void {
    this.replaceRow.style.display = this.replaceRow.style.display === 'none' ? '' : 'none'
  }

  get isVisible(): boolean {
    return this.visible
  }

  hide(): void {
    if (!this.visible) return
    this.visible = false
    this.el.style.display = 'none'
    this.matches = []
    this.current = -1
    this.pushState()
    this.editor.commands.focus()
  }

  private search(): void {
    this.matches = findMatches(this.editor.state.doc, this.findInput.value)
    // Start from the match nearest the caret
    const caret = this.editor.state.selection.from
    this.current = this.matches.length ? this.matches.findIndex(m => m.from >= caret) : -1
    if (this.matches.length && this.current === -1) this.current = 0
    this.pushState()
    this.updateCount()
    this.revealCurrent()
  }

  private step(dir: 1 | -1): void {
    if (this.matches.length === 0) return
    this.current = ((this.current + dir) % this.matches.length + this.matches.length) % this.matches.length
    this.pushState()
    this.updateCount()
    this.revealCurrent()
  }

  private replaceCurrent(): void {
    const match = this.matches[this.current]
    if (!match) return
    this.editor.commands.insertContentAt({ from: match.from, to: match.to }, this.replaceInput.value, { contentType: 'text' } as never)
    this.search()
  }

  private replaceAll(): void {
    if (this.matches.length === 0) return
    const replacement = this.replaceInput.value
    const { tr } = this.editor.state
    for (const match of [...this.matches].reverse()) {
      if (replacement) {
        tr.replaceWith(match.from, match.to, this.editor.state.schema.text(replacement))
      } else {
        tr.delete(match.from, match.to)
      }
    }
    this.editor.view.dispatch(tr)
    this.search()
  }

  private pushState(): void {
    const tr = this.editor.state.tr.setMeta(findKey, { matches: this.matches, current: this.current })
    this.editor.view.dispatch(tr)
  }

  private updateCount(): void {
    if (!this.findInput.value) {
      this.countEl.textContent = ''
    } else if (this.matches.length === 0) {
      this.countEl.textContent = '0'
    } else {
      this.countEl.textContent = `${this.current + 1}/${this.matches.length}`
    }
  }

  private revealCurrent(): void {
    const match = this.matches[this.current]
    if (!match) return
    try {
      const dom = this.editor.view.domAtPos(match.from)
      const el = dom.node instanceof Element ? dom.node : dom.node.parentElement
      el?.scrollIntoView({ block: 'center', behavior: 'auto' })
    } catch {
      // Position may be stale mid-edit; next search() corrects it.
    }
  }
}

function textButton(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'find-bar-btn'
  btn.textContent = label
  btn.addEventListener('click', onClick)
  return btn
}
