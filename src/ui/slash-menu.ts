// Slash command menu: type "/" at the start of a line (or after a space) to
// insert blocks, Notion-style. The query is typed into the document and
// removed when a command is applied.
import type { Editor } from '@tiptap/core'
import { icons, type IconName } from '../icons'
import { Popover } from './popover'

interface SlashItem {
  label: string
  hint: string
  icon: IconName
  keywords: string
  apply: (editor: Editor) => void
  /** Set on math items: open the LaTeX editor right after inserting */
  mathKind?: 'inline' | 'block'
}

export interface SlashMenuHooks {
  onMathInserted?: (kind: 'inline' | 'block', pos: number) => void
}

const ITEMS: SlashItem[] = [
  { label: 'Text', hint: 'Plain paragraph', icon: 'text', keywords: 'paragraph plain', apply: e => e.chain().focus().clearNodes().run() },
  { label: 'Heading 1', hint: 'Large section heading', icon: 'h1', keywords: 'h1 title', apply: e => e.chain().focus().clearNodes().setHeading({ level: 1 }).run() },
  { label: 'Heading 2', hint: 'Medium section heading', icon: 'h2', keywords: 'h2 subtitle', apply: e => e.chain().focus().clearNodes().setHeading({ level: 2 }).run() },
  { label: 'Heading 3', hint: 'Small section heading', icon: 'h3', keywords: 'h3', apply: e => e.chain().focus().clearNodes().setHeading({ level: 3 }).run() },
  { label: 'Bullet list', hint: 'Simple bulleted list', icon: 'bulletList', keywords: 'ul unordered', apply: e => e.chain().focus().clearNodes().toggleBulletList().run() },
  { label: 'Numbered list', hint: 'List with numbering', icon: 'orderedList', keywords: 'ol ordered', apply: e => e.chain().focus().clearNodes().toggleOrderedList().run() },
  { label: 'Task list', hint: 'List with checkboxes', icon: 'taskList', keywords: 'todo checkbox check', apply: e => e.chain().focus().clearNodes().toggleTaskList().run() },
  { label: 'Quote', hint: 'Blockquote', icon: 'quote', keywords: 'blockquote citation', apply: e => e.chain().focus().clearNodes().toggleBlockquote().run() },
  { label: 'Code block', hint: 'Code with highlighting', icon: 'codeBlock', keywords: 'fence pre snippet', apply: e => e.chain().focus().clearNodes().setCodeBlock().run() },
  { label: 'Table', hint: '3×3 table', icon: 'table', keywords: 'grid rows columns', apply: e => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { label: 'Divider', hint: 'Horizontal rule', icon: 'divider', keywords: 'hr rule separator line', apply: e => e.chain().focus().setHorizontalRule().run() },
  { label: 'Inline math', hint: 'LaTeX in text, $x$', icon: 'math', keywords: 'latex katex equation formula', apply: e => e.chain().focus().insertInlineMath({ latex: 'x' }).run(), mathKind: 'inline' },
  { label: 'Block math', hint: 'Display equation, $$x$$', icon: 'math', keywords: 'latex katex equation formula display', apply: e => e.chain().focus().insertBlockMath({ latex: 'x = y' }).run(), mathKind: 'block' },
]

export class SlashMenu {
  private editor: Editor
  private popover: Popover
  private list: HTMLDivElement
  private slashPos = -1
  private selected = 0
  private filtered: SlashItem[] = ITEMS

  private hooks: SlashMenuHooks

  constructor(editor: Editor, hooks: SlashMenuHooks = {}) {
    this.editor = editor
    this.hooks = hooks
    this.popover = new Popover({ className: 'slash-menu', align: 'start', onHide: () => { this.slashPos = -1 } })
    this.list = document.createElement('div')
    this.list.className = 'slash-menu-list'
    this.popover.el.appendChild(this.list)
    // Don't steal focus from the editor
    this.popover.el.addEventListener('mousedown', e => e.preventDefault())

    editor.view.dom.addEventListener('keydown', this.onKeyDown, true)
    editor.on('update', this.onUpdate)
    editor.on('selectionUpdate', this.onSelectionChange)
  }

  get isOpen(): boolean {
    return this.slashPos >= 0
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.isOpen) {
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const { state } = this.editor
        const { $from } = state.selection
        if ($from.parent.type.name === 'codeBlock') return
        const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
        if (before === '' || before.endsWith(' ')) {
          // The query() validation in open() rejects anything that didn't
          // actually produce a "/" at this position (e.g. replaced selections).
          // open after the character is inserted
          this.slashPos = state.selection.from
          setTimeout(() => this.open(), 0)
        }
      }
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        e.stopPropagation()
        this.select(this.selected + 1)
        break
      case 'ArrowUp':
        e.preventDefault()
        e.stopPropagation()
        this.select(this.selected - 1)
        break
      case 'Enter':
        e.preventDefault()
        e.stopPropagation()
        this.apply(this.filtered[this.selected])
        break
      case 'Escape':
        e.preventDefault()
        e.stopPropagation()
        this.close()
        break
      default:
        break
    }
  }

  private onUpdate = (): void => {
    if (this.isOpen) this.refresh()
  }

  private onSelectionChange = (): void => {
    if (!this.isOpen) return
    const head = this.editor.state.selection.head
    if (head <= this.slashPos || head > this.slashPos + 32) this.close()
  }

  private open(): void {
    this.refresh()
    if (!this.isOpen) return
    const coords = this.editor.view.coordsAtPos(this.slashPos)
    this.popover.show({ left: coords.left, top: coords.top, right: coords.left + 1, bottom: coords.bottom })
  }

  private query(): string | null {
    const { state } = this.editor
    const head = state.selection.head
    if (this.slashPos < 0 || head < this.slashPos + 1) return null
    let text: string
    try {
      text = state.doc.textBetween(this.slashPos, head, '\n', '￼')
    } catch {
      return null
    }
    if (!text.startsWith('/')) return null
    const q = text.slice(1)
    if (/[\n￼]/.test(q) || q.length > 24) return null
    return q
  }

  private refresh(): void {
    const q = this.query()
    if (q === null) {
      this.close()
      return
    }
    const needle = q.toLowerCase()
    this.filtered = ITEMS.filter(item =>
      item.label.toLowerCase().includes(needle) || item.keywords.includes(needle),
    )
    if (this.filtered.length === 0) {
      this.close()
      return
    }
    this.selected = Math.min(this.selected, this.filtered.length - 1)
    this.renderList()
    this.popover.reposition()
  }

  private renderList(): void {
    this.list.textContent = ''
    this.filtered.forEach((item, i) => {
      const row = document.createElement('button')
      row.type = 'button'
      row.className = 'slash-menu-item'
      row.classList.toggle('selected', i === this.selected)
      row.innerHTML = `<span class="slash-menu-icon">${icons[item.icon]}</span><span class="slash-menu-text"><span class="slash-menu-label">${item.label}</span><span class="slash-menu-hint">${item.hint}</span></span>`
      row.addEventListener('click', () => this.apply(item))
      row.addEventListener('mousemove', () => {
        if (this.selected !== i) {
          this.selected = i
          this.renderList()
        }
      })
      this.list.appendChild(row)
    })
  }

  private select(index: number): void {
    const n = this.filtered.length
    this.selected = ((index % n) + n) % n
    this.renderList()
    this.list.querySelector('.selected')?.scrollIntoView({ block: 'nearest' })
  }

  private apply(item: SlashItem | undefined): void {
    if (!item) return
    const from = this.slashPos
    const to = this.editor.state.selection.head
    this.close()
    this.editor.chain().focus().deleteRange({ from, to }).run()
    item.apply(this.editor)

    if (item.mathKind && this.hooks.onMathInserted) {
      // The inserted math atom sits just before the new selection
      const head = this.editor.state.selection.from
      for (const pos of [head - 1, head - 2]) {
        if (pos < 0) continue
        const node = this.editor.state.doc.nodeAt(pos)
        if (node && (node.type.name === 'inlineMath' || node.type.name === 'blockMath')) {
          this.hooks.onMathInserted(item.mathKind, pos)
          break
        }
      }
    }
  }

  private close(): void {
    this.popover.hide()
  }

  destroy(): void {
    this.editor.view.dom.removeEventListener('keydown', this.onKeyDown, true)
    this.editor.off('update', this.onUpdate)
    this.editor.off('selectionUpdate', this.onSelectionChange)
    this.popover.destroy()
  }
}
