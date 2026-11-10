// Table UI: column alignment, hover add-row/column affordances, delete-table
// by key, move row/column, GFM-safe header handling.
//
// Header decision: a GFM table always has a header row and it is always the
// FIRST row. An appendTransaction normaliser keeps that invariant: after any
// change that touches a table, row 0 holds `tableHeader` cells and every other
// row holds `tableCell`s. Header styling therefore follows position, not
// content: moving row 1 up swaps it with the header (the old header becomes an
// ordinary body row), moving the header down does the reverse. The old
// "Toggle header row" command is no longer offered anywhere.
import type { Editor } from '@tiptap/core'
import { keydownHandler } from '@tiptap/pm/keymap'
import { Mapping } from '@tiptap/pm/transform'
import {
  NodeSelection,
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction,
} from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import {
  CellSelection,
  TableMap,
  addColumn,
  addRow,
  isInTable,
  moveTableColumn,
  moveTableRow,
  selectedRect,
  type TableRect,
} from '@tiptap/pm/tables'
import { TableHoverControls } from '../ui/table-controls'

export type CellAlign = 'left' | 'center' | 'right' | null
type Dispatch = ((tr: Transaction) => void) | undefined

/** Rect of the table region the selection covers (whole table for a node selection). */
export function tableRectOf(state: EditorState): TableRect | null {
  const sel = state.selection
  if (sel instanceof NodeSelection && sel.node.type.spec.tableRole === 'table') {
    const map = TableMap.get(sel.node)
    return { left: 0, top: 0, right: map.width, bottom: map.height, tableStart: sel.from + 1, map, table: sel.node }
  }
  if (!isInTable(state)) return null
  try {
    return selectedRect(state)
  } catch {
    return null
  }
}

// ------------------------------------------------------------- alignment

/** Alignment shared by the selected column(s) (first non-null cell wins, like the serializer); null if none or mixed. */
export function columnAlign(state: EditorState): CellAlign {
  const rect = tableRectOf(state)
  if (!rect) return null
  const { map, table } = rect
  let result: CellAlign | undefined
  for (let c = rect.left; c < rect.right; c++) {
    let colAlign: CellAlign = null
    for (let r = 0; r < map.height; r++) {
      const node = table.nodeAt(map.map[r * map.width + c])
      const a = node?.attrs.align as CellAlign | undefined
      if (a) { colAlign = a; break }
    }
    if (result === undefined) result = colAlign
    else if (result !== colAlign) return null
  }
  return result ?? null
}

/** Set `align` on every cell of the selected column(s). */
export function setColumnAlign(align: CellAlign) {
  return (state: EditorState, dispatch?: Dispatch): boolean => {
    const rect = tableRectOf(state)
    if (!rect) return false
    if (dispatch) {
      const { map, tableStart } = rect
      const tr = state.tr
      const offsets = map.cellsInRect({ left: rect.left, right: rect.right, top: 0, bottom: map.height })
      for (const off of offsets) {
        const pos = tableStart + off
        const node = tr.doc.nodeAt(pos)
        if (node && (node.attrs.align ?? null) !== align) tr.setNodeAttribute(pos, 'align', align)
      }
      if (tr.docChanged) dispatch(tr.scrollIntoView())
    }
    return true
  }
}

// ----------------------------------------------------------------- move

function cellStart(rect: TableRect, row: number, col: number): number {
  return rect.tableStart + rect.map.map[row * rect.map.width + col]
}

/** Restore the selection after a move, shifted to the cells' new coordinates. */
function reselectMoved(tr: Transaction, before: EditorState, rect: TableRect, dRow: number, dCol: number): void {
  const sel = before.selection
  const table = tr.doc.nodeAt(rect.tableStart - 1)
  if (!table) return
  const map = TableMap.get(table)
  const at = (row: number, col: number): number => rect.tableStart + map.map[row * map.width + col]
  try {
    if (sel instanceof CellSelection) {
      tr.setSelection(CellSelection.create(tr.doc, at(rect.top + dRow, rect.left + dCol), at(rect.bottom - 1 + dRow, rect.right - 1 + dCol)))
    } else if (sel instanceof TextSelection) {
      const oldCell = cellStart(rect, rect.top, rect.left)
      const newCell = at(rect.top + dRow, rect.left + dCol)
      const newNode = tr.doc.nodeAt(newCell)
      if (!newNode) return
      const max = newCell + newNode.nodeSize - 1
      const clamp = (p: number): number => Math.max(newCell + 1, Math.min(max, newCell + (p - oldCell)))
      tr.setSelection(TextSelection.create(tr.doc, clamp(sel.anchor), clamp(sel.head)))
    }
  } catch {
    // leave the mapped selection in place
  }
}

function moveAxis(axis: 'row' | 'col', dir: -1 | 1) {
  return (state: EditorState, dispatch?: Dispatch): boolean => {
    const sel = state.selection
    if (!(sel instanceof TextSelection) && !(sel instanceof CellSelection)) return false
    const rect = tableRectOf(state)
    if (!rect) return false
    const lo = axis === 'row' ? rect.top : rect.left
    const hi = axis === 'row' ? rect.bottom : rect.right
    const count = axis === 'row' ? rect.map.height : rect.map.width
    if (dir < 0 ? lo <= 0 : hi >= count) return true // at the edge: swallow the key
    const to = dir < 0 ? lo - 1 : hi
    const run = axis === 'row' ? moveTableRow : moveTableColumn
    let moved: Transaction | null = null
    const ok = run({ from: lo, to, select: false, pos: sel.from })(state, tr => { moved = tr })
    if (!ok || !moved) return false
    if (dispatch) {
      const tr: Transaction = moved
      reselectMoved(tr, state, rect, axis === 'row' ? dir : 0, axis === 'col' ? dir : 0)
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

export const moveRowUp = moveAxis('row', -1)
export const moveRowDown = moveAxis('row', 1)
export const moveColumnLeft = moveAxis('col', -1)
export const moveColumnRight = moveAxis('col', 1)

// --------------------------------------------------------- delete by key

function wholeTableSelected(state: EditorState): TableRect | null {
  const sel = state.selection
  if (sel instanceof NodeSelection) return sel.node.type.spec.tableRole === 'table' ? tableRectOf(state) : null
  if (sel instanceof CellSelection) {
    const r = tableRectOf(state)
    if (r && r.left === 0 && r.top === 0 && r.right === r.map.width && r.bottom === r.map.height) return r
  }
  return null
}

function deleteWholeTable(state: EditorState, dispatch?: Dispatch): boolean {
  const rect = wholeTableSelected(state)
  if (!rect) return false
  if (dispatch) {
    const from = rect.tableStart - 1
    const tr = state.tr.delete(from, from + rect.table.nodeSize)
    const pos = Math.min(from, tr.doc.content.size)
    tr.setSelection(TextSelection.near(tr.doc.resolve(pos), -1))
    dispatch(tr.scrollIntoView())
  }
  return true
}

// ------------------------------------------------------- append row/col

/** Resolve the table that holds a DOM <table> element (null if it can't be mapped). */
function tableAtDom(view: EditorView, tableEl: Element): TableRect | null {
  const cell = tableEl.querySelector('td, th')
  if (!cell) return null
  let pos: number
  try {
    pos = view.posAtDOM(cell, 0)
  } catch {
    return null
  }
  const $pos = view.state.doc.resolve(pos)
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d)
    if (node.type.spec.tableRole === 'table') {
      return { left: 0, top: 0, right: 0, bottom: 0, tableStart: $pos.start(d), map: TableMap.get(node), table: node }
    }
  }
  return null
}

function appendTo(view: EditorView, tableEl: Element, axis: 'row' | 'col'): void {
  const rect = tableAtDom(view, tableEl)
  if (!rect) return
  const tr = view.state.tr
  if (axis === 'row') addRow(tr, rect, rect.map.height)
  else addColumn(tr, rect, rect.map.width)
  const table = tr.doc.nodeAt(rect.tableStart - 1)
  if (table) {
    // Caret into the first new cell so typing can continue immediately.
    const map = TableMap.get(table)
    const idx = axis === 'row' ? (map.height - 1) * map.width : map.width - 1
    try {
      tr.setSelection(TextSelection.near(tr.doc.resolve(rect.tableStart + map.map[idx] + 1)))
    } catch {
      // keep mapped selection
    }
  }
  view.dispatch(tr.scrollIntoView())
  view.focus()
}

// -------------------------------------------------------- header invariant

function touchedRanges(trs: readonly Transaction[], size: number): Array<[number, number]> {
  const all = new Mapping()
  for (const tr of trs) for (const m of tr.mapping.maps) all.appendMap(m)
  const out: Array<[number, number]> = []
  all.maps.forEach((m, i) => {
    const rest = all.slice(i + 1)
    m.forEach((_os, _oe, ns, ne) => {
      const a = Math.max(0, Math.min(size, rest.map(ns, -1)))
      const b = Math.max(a, Math.min(size, rest.map(ne, 1)))
      out.push([a, b])
    })
  })
  return out
}

function normaliseHeaders(trs: readonly Transaction[], newState: EditorState): Transaction | null {
  if (!trs.some(t => t.docChanged)) return null
  const { tableHeader, tableCell } = newState.schema.nodes
  if (!tableHeader || !tableCell) return null
  const doc = newState.doc
  let out: Transaction | null = null
  const seen = new Set<number>()
  for (const [a, b] of touchedRanges(trs, doc.content.size)) {
    doc.nodesBetween(a, b, (node, pos) => {
      if (node.type.spec.tableRole !== 'table') return true
      if (seen.has(pos)) return false
      seen.add(pos)
      node.forEach((row, rowOff, ri) => {
        const want = ri === 0 ? tableHeader : tableCell
        row.forEach((cell, cellOff) => {
          if (cell.type === want) return
          out ??= newState.tr
          out.setNodeMarkup(pos + 1 + rowOff + 1 + cellOff, want, cell.attrs, cell.marks)
        })
      })
      return false
    })
  }
  return out
}

// ---------------------------------------------------------------- plugins

const hoverKey = new PluginKey('quillTableHover')

export function tableControlsPlugins(_editor: Editor): Plugin[] {
  const keys = keydownHandler({
    Backspace: deleteWholeTable,
    Delete: deleteWholeTable,
    'Mod-Backspace': deleteWholeTable,
    'Mod-Alt-ArrowUp': moveRowUp,
    'Mod-Alt-ArrowDown': moveRowDown,
    'Mod-Alt-ArrowLeft': moveColumnLeft,
    'Mod-Alt-ArrowRight': moveColumnRight,
  })
  const keymapPlugin = new Plugin({
    key: new PluginKey('quillTableKeys'),
    props: {
      handleKeyDown(view, event) {
        // Cheap early-out: only table selections or Mod-Alt-Arrow matter.
        if (!isInTable(view.state) && !(view.state.selection instanceof NodeSelection)) return false
        return keys(view, event)
      },
    },
    appendTransaction: (trs, _old, newState) => normaliseHeaders(trs, newState),
  })
  const hoverPlugin = new Plugin({
    key: hoverKey,
    view(view) {
      const controls = new TableHoverControls(view, {
        addRow: el => appendTo(view, el, 'row'),
        addColumn: el => appendTo(view, el, 'col'),
      })
      return { update: () => controls.refresh(), destroy: () => controls.destroy() }
    },
  })
  return [keymapPlugin, hoverPlugin]
}
