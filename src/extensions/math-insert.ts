// Inline math without the slash menu: ⌘⇧M (also Format > Inline Math and the
// bubble-menu ∑ button). With text selected the selection becomes the LaTeX
// (surrounding $ stripped); with a caret an `x` placeholder is inserted and
// the math popover opens on it. The `$...$` input rule is unchanged.
import type { Editor } from '@tiptap/core'

type InsertedHandler = (pos: number) => void
let onInserted: InsertedHandler | null = null

/** main.ts registers the popover opener here. */
export function setInlineMathHandler(fn: InsertedHandler | null): void {
  onInserted = fn
}

export function insertInlineMath(editor: Editor): boolean {
  if (!editor.schema.nodes.inlineMath) return false
  const { from, to, empty, $from } = editor.state.selection
  if ($from.parent.type.spec.code) return false
  const selected = empty ? '' : editor.state.doc.textBetween(from, to, ' ')
  const latex = selected.trim().replace(/^\$+|\$+$/g, '').trim()
  const ok = editor
    .chain()
    .focus()
    .insertContentAt({ from, to }, { type: 'inlineMath', attrs: { latex: latex || 'x' } })
    .run()
  if (ok && !latex) {
    requestAnimationFrame(() => onInserted?.(from))
  }
  return ok
}
