// Selection formatting bar: appears over text selections, Notion-style.
// Hand-rolled (no floating-ui dep): positioned from selection coords.
import type { Editor } from '@tiptap/core'
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import { icons, type IconName } from '../icons'
import { hideAllPopovers } from './popover'
import { insertInlineMath } from '../extensions/math-insert'
import { tableIcons } from './table-controls'
import {
  columnAlign, moveColumnLeft, moveColumnRight, moveRowDown, moveRowUp, setColumnAlign,
  type CellAlign,
} from '../extensions/table-controls'

interface ButtonSpec {
  icon?: IconName
  /** Inline SVG for icons that are not in the shared set (table controls). */
  svg?: string
  title: string
  isActive?: (editor: Editor) => boolean
  onClick: (editor: Editor) => void
  /** Show only when inside a table */
  tableOnly?: boolean
  /** Draw a divider before this button (table group) */
  groupStart?: boolean
}

const TEXT_BUTTONS: ButtonSpec[] = [
  {
    icon: 'bold',
    title: 'Bold (⌘B)',
    isActive: e => e.isActive('bold'),
    onClick: e => e.chain().focus().toggleBold().run(),
  },
  {
    icon: 'italic',
    title: 'Italic (⌘I)',
    isActive: e => e.isActive('italic'),
    onClick: e => e.chain().focus().toggleItalic().run(),
  },
  {
    icon: 'underline',
    title: 'Underline (⌘U)',
    isActive: e => e.isActive('underline'),
    onClick: e => e.chain().focus().toggleUnderline().run(),
  },
  {
    icon: 'strike',
    title: 'Strikethrough',
    isActive: e => e.isActive('strike'),
    onClick: e => e.chain().focus().toggleStrike().run(),
  },
  {
    icon: 'code',
    title: 'Inline code (⌘E)',
    isActive: e => e.isActive('code'),
    onClick: e => e.chain().focus().toggleCode().run(),
  },
  {
    icon: 'math',
    title: 'Inline math (⌘⇧M)',
    isActive: e => e.isActive('inlineMath'),
    onClick: e => void insertInlineMath(e),
  },
]

/** Run a ProseMirror command from a toolbar button, then return focus to the editor. */
function runCommand(e: Editor, cmd: (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean): void {
  cmd(e.state, tr => e.view.dispatch(tr))
  e.view.focus()
}

/** Click an alignment button: set it, or clear it when it is already active. */
function alignButton(editor: Editor, target: Exclude<CellAlign, null>): void {
  runCommand(editor, setColumnAlign(columnAlign(editor.state) === target ? null : target))
}

// Header handling: a GFM table always keeps its first row as the header (see
// extensions/table-controls.ts), so there is deliberately no header toggle.
const TABLE_BUTTONS: ButtonSpec[] = [
  { icon: 'rowBelow', title: 'Add row below (or Tab in the last cell)', onClick: e => e.chain().focus().addRowAfter().run(), tableOnly: true },
  { icon: 'rowAbove', title: 'Add row above', onClick: e => e.chain().focus().addRowBefore().run(), tableOnly: true },
  { icon: 'colAfter', title: 'Add column right', onClick: e => e.chain().focus().addColumnAfter().run(), tableOnly: true },
  { icon: 'colBefore', title: 'Add column left', onClick: e => e.chain().focus().addColumnBefore().run(), tableOnly: true },
  { svg: tableIcons.alignLeft, title: 'Align column left', groupStart: true, isActive: e => columnAlign(e.state) === 'left', onClick: e => alignButton(e, 'left'), tableOnly: true },
  { svg: tableIcons.alignCenter, title: 'Align column center', isActive: e => columnAlign(e.state) === 'center', onClick: e => alignButton(e, 'center'), tableOnly: true },
  { svg: tableIcons.alignRight, title: 'Align column right', isActive: e => columnAlign(e.state) === 'right', onClick: e => alignButton(e, 'right'), tableOnly: true },
  { svg: tableIcons.moveUp, title: 'Move row up (⌥⌘↑)', groupStart: true, onClick: e => runCommand(e, moveRowUp), tableOnly: true },
  { svg: tableIcons.moveDown, title: 'Move row down (⌥⌘↓)', onClick: e => runCommand(e, moveRowDown), tableOnly: true },
  { svg: tableIcons.moveLeft, title: 'Move column left (⌥⌘←)', onClick: e => runCommand(e, moveColumnLeft), tableOnly: true },
  { svg: tableIcons.moveRight, title: 'Move column right (⌥⌘→)', onClick: e => runCommand(e, moveColumnRight), tableOnly: true },
  { icon: 'rowDelete', title: 'Delete row', groupStart: true, onClick: e => e.chain().focus().deleteRow().run(), tableOnly: true },
  { icon: 'colDelete', title: 'Delete column', onClick: e => e.chain().focus().deleteColumn().run(), tableOnly: true },
  { icon: 'trash', title: 'Delete table', onClick: e => e.chain().focus().deleteTable().run(), tableOnly: true },
]

interface TurnIntoOption {
  label: string
  icon: IconName
  isActive: (e: Editor) => boolean
  apply: (e: Editor) => void
}

const TURN_INTO: TurnIntoOption[] = [
  { label: 'Text', icon: 'text', isActive: e => e.isActive('paragraph') && !e.isActive('bulletList') && !e.isActive('orderedList') && !e.isActive('taskList') && !e.isActive('blockquote'), apply: e => e.chain().focus().clearNodes().run() },
  { label: 'Heading 1', icon: 'h1', isActive: e => e.isActive('heading', { level: 1 }), apply: e => e.chain().focus().clearNodes().setHeading({ level: 1 }).run() },
  { label: 'Heading 2', icon: 'h2', isActive: e => e.isActive('heading', { level: 2 }), apply: e => e.chain().focus().clearNodes().setHeading({ level: 2 }).run() },
  { label: 'Heading 3', icon: 'h3', isActive: e => e.isActive('heading', { level: 3 }), apply: e => e.chain().focus().clearNodes().setHeading({ level: 3 }).run() },
  { label: 'Bullet list', icon: 'bulletList', isActive: e => e.isActive('bulletList'), apply: e => e.chain().focus().clearNodes().toggleBulletList().run() },
  { label: 'Numbered list', icon: 'orderedList', isActive: e => e.isActive('orderedList'), apply: e => e.chain().focus().clearNodes().toggleOrderedList().run() },
  { label: 'Task list', icon: 'taskList', isActive: e => e.isActive('taskList'), apply: e => e.chain().focus().clearNodes().toggleTaskList().run() },
  { label: 'Quote', icon: 'quote', isActive: e => e.isActive('blockquote'), apply: e => e.chain().focus().clearNodes().toggleBlockquote().run() },
  { label: 'Code block', icon: 'codeBlock', isActive: e => e.isActive('codeBlock'), apply: e => e.chain().focus().clearNodes().toggleCodeBlock().run() },
]

export class BubbleMenu {
  private el: HTMLDivElement
  private dropdown: HTMLDivElement
  private dropdownBtn: HTMLButtonElement
  private textDivider!: HTMLDivElement
  private buttons: Array<{ spec: ButtonSpec; el: HTMLButtonElement }> = []
  private visible = false
  private dropdownOpen = false
  private editor: Editor
  private raf = 0

  constructor(editor: Editor, onLinkEdit: () => void) {
    this.editor = editor

    this.el = document.createElement('div')
    this.el.className = 'bubble-menu'
    this.el.setAttribute('role', 'toolbar')
    this.el.style.display = 'none'
    // Keep editor selection: don't steal focus on button presses
    this.el.addEventListener('mousedown', e => {
      if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault()
    })

    // Turn-into dropdown
    this.dropdownBtn = document.createElement('button')
    this.dropdownBtn.className = 'bubble-btn bubble-turninto'
    this.dropdownBtn.type = 'button'
    this.dropdownBtn.innerHTML = `<span class="bubble-turninto-label">Text</span>${icons.chevronDown}`
    this.dropdownBtn.addEventListener('click', () => this.toggleDropdown())

    this.dropdown = document.createElement('div')
    this.dropdown.className = 'bubble-dropdown'
    this.dropdown.style.display = 'none'
    for (const option of TURN_INTO) {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'bubble-dropdown-item'
      item.innerHTML = `${icons[option.icon]}<span>${option.label}</span>`
      item.addEventListener('click', () => {
        option.apply(this.editor)
        this.closeDropdown()
      })
      this.dropdown.appendChild(item)
    }

    this.el.appendChild(this.dropdownBtn)
    this.textDivider = divider()
    this.el.appendChild(this.textDivider)

    for (const spec of TEXT_BUTTONS) {
      this.addButton(spec)
    }

    const linkBtn = document.createElement('button')
    linkBtn.className = 'bubble-btn'
    linkBtn.type = 'button'
    linkBtn.title = 'Link (⌘K)'
    linkBtn.innerHTML = icons.link
    linkBtn.addEventListener('click', () => onLinkEdit())
    this.buttons.push({
      spec: { icon: 'link', title: 'Link', isActive: e => e.isActive('link'), onClick: () => onLinkEdit() },
      el: linkBtn,
    })
    this.el.appendChild(linkBtn)

    const tableDivider = divider()
    tableDivider.dataset.tableOnly = '1'
    this.el.appendChild(tableDivider)
    for (const spec of TABLE_BUTTONS) {
      if (spec.groupStart) {
        const sep = divider()
        sep.dataset.tableOnly = '1'
        sep.dataset.tableSep = '1'
        this.el.appendChild(sep)
      }
      this.addButton(spec)
    }

    this.el.appendChild(this.dropdown)
    document.body.appendChild(this.el)

    editor.on('selectionUpdate', this.scheduleUpdate)
    editor.on('transaction', this.scheduleUpdate)
    editor.on('blur', this.onBlur)
    window.addEventListener('resize', this.scheduleUpdate)
    document.getElementById('editor-container')?.addEventListener('scroll', this.scheduleUpdate, { passive: true })
  }

  private addButton(spec: ButtonSpec): void {
    const btn = document.createElement('button')
    btn.className = 'bubble-btn'
    btn.type = 'button'
    btn.title = spec.title
    btn.innerHTML = spec.svg ?? (spec.icon ? icons[spec.icon] : '')
    if (spec.tableOnly) btn.dataset.tableOnly = '1'
    btn.addEventListener('click', () => {
      spec.onClick(this.editor)
      this.scheduleUpdate()
    })
    this.buttons.push({ spec, el: btn })
    this.el.appendChild(btn)
  }

  private onBlur = (): void => {
    // Allow click-through to our own buttons (mousedown is prevented, so blur
    // only fires when focus genuinely left the editor).
    setTimeout(() => {
      if (!this.el.contains(document.activeElement)) this.hide()
    }, 0)
  }

  private scheduleUpdate = (): void => {
    cancelAnimationFrame(this.raf)
    this.raf = requestAnimationFrame(() => this.update())
  }

  private update(): void {
    const { state, view } = this.editor
    const { from, to, empty } = state.selection
    // instanceof, not constructor.name: class names are minified in release
    const isText = state.selection instanceof TextSelection
    const inCode = this.editor.isActive('codeBlock')
    const focusedHere = this.editor.isFocused || this.el.contains(document.activeElement)
    const inTable = this.editor.isActive('table')

    // Two modes: text selection (full toolbar), or caret inside a table
    // (table controls only — otherwise rows/columns are undiscoverable).
    const selectionMode = !empty && isText && !inCode && focusedHere
    // Cell selections (several cells / a row / a column) keep the table bar up
    // so alignment and move buttons work on them.
    const isCells = state.selection instanceof CellSelection
    const tableCaretMode = !selectionMode && inTable && (isText || isCells) && focusedHere

    if (!selectionMode && !tableCaretMode) {
      this.hide()
      return
    }

    // Only show for positions with resolvable coords
    let start
    let end
    try {
      start = view.coordsAtPos(from)
      end = view.coordsAtPos(to)
    } catch {
      this.hide()
      return
    }

    this.visible = true
    this.el.style.display = 'flex'

    // Button group visibility per mode
    const showText = selectionMode
    this.dropdownBtn.style.display = showText ? '' : 'none'
    this.textDivider.style.display = showText ? '' : 'none'
    if (!showText) this.closeDropdown()
    for (const { spec, el } of this.buttons) {
      el.style.display = spec.tableOnly ? (inTable ? '' : 'none') : (showText ? '' : 'none')
      el.classList.toggle('active', (!spec.tableOnly || inTable) && (spec.isActive?.(this.editor) ?? false))
    }
    for (const d of this.el.querySelectorAll<HTMLElement>('.bubble-divider[data-table-only]')) {
      d.style.display = d.dataset.tableSep ? (inTable ? '' : 'none') : (inTable && showText ? '' : 'none')
    }

    if (showText) {
      const current = TURN_INTO.find(o => o.isActive(this.editor))
      const label = this.dropdownBtn.querySelector('.bubble-turninto-label')!
      label.textContent = current?.label ?? 'Text'
    }

    // Selection mode: float above the selection. Table-caret mode: anchor to
    // the table's top edge so the bar doesn't chase the caret while typing.
    let anchorLeft = Math.min(start.left, end.left)
    let anchorRight = Math.max(start.right, end.right)
    let anchorTop = start.top
    let anchorBottom = end.bottom
    if (tableCaretMode) {
      const domAt = view.domAtPos(from).node
      const el = domAt instanceof Element ? domAt : domAt.parentElement
      const tableEl = el?.closest('.tableWrapper, table')
      if (tableEl) {
        const r = tableEl.getBoundingClientRect()
        anchorLeft = r.left
        anchorRight = r.right
        anchorTop = r.top
        anchorBottom = r.top + 1
      }
    }

    const rect = this.el.getBoundingClientRect()
    const centerX = (anchorLeft + anchorRight) / 2
    let left = centerX - rect.width / 2
    left = Math.max(8, Math.min(left, window.innerWidth - rect.width - 8))
    let top = anchorTop - rect.height - 10
    if (top < 60) top = anchorBottom + 10
    this.el.style.left = `${Math.round(left)}px`
    this.el.style.top = `${Math.round(top)}px`
  }

  private toggleDropdown(): void {
    this.dropdownOpen = !this.dropdownOpen
    this.dropdown.style.display = this.dropdownOpen ? 'flex' : 'none'
    if (this.dropdownOpen) {
      hideAllPopovers()
      for (const item of this.dropdown.querySelectorAll('.bubble-dropdown-item')) {
        const idx = [...this.dropdown.children].indexOf(item)
        item.classList.toggle('active', TURN_INTO[idx]?.isActive(this.editor) ?? false)
      }
    }
  }

  private closeDropdown(): void {
    this.dropdownOpen = false
    this.dropdown.style.display = 'none'
  }

  hide(): void {
    if (!this.visible) return
    this.visible = false
    this.closeDropdown()
    this.el.style.display = 'none'
  }

  destroy(): void {
    this.editor.off('selectionUpdate', this.scheduleUpdate)
    this.editor.off('transaction', this.scheduleUpdate)
    this.editor.off('blur', this.onBlur)
    window.removeEventListener('resize', this.scheduleUpdate)
    this.el.remove()
  }
}

function divider(): HTMLDivElement {
  const d = document.createElement('div')
  d.className = 'bubble-divider'
  return d
}
