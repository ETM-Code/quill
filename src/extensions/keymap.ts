// Typora/Notion-style editing shortcuts that StarterKit doesn't provide, plus
// the fix for ⌘⇧S (StarterKit binds it to strikethrough; on a Mac it is Save
// As, handled app-wide in main.ts). Strikethrough moves to ⌘⇧X.
//
// App-level shortcuts that must also work outside the editor (⌘/ source
// toggle, ⌘P print, ⌘S save, ...) live in main.ts's document keydown handler.
import type { Editor } from '@tiptap/core'
import { keymap } from '@tiptap/pm/keymap'
import type { Plugin } from '@tiptap/pm/state'
import { insertInlineMath } from './math-insert'
import { copyAsPlainText } from './plain-text'

type Level = 1 | 2 | 3 | 4 | 5 | 6

/** Run a named editor command; false when it doesn't exist in this schema. */
function run(editor: Editor, fn: (chain: any) => any): boolean {
  try {
    return fn(editor.chain().focus()).run() as boolean
  } catch {
    return false
  }
}

export function formatCommands(editor: Editor) {
  return {
    heading: (level: Level) => run(editor, c => c.toggleHeading({ level })),
    paragraph: () => run(editor, c => c.setParagraph()),
    codeBlock: () => run(editor, c => c.toggleCodeBlock()),
    strike: () => run(editor, c => c.toggleStrike()),
    highlight: () => (editor.schema.marks.highlight ? run(editor, c => c.toggleHighlight()) : false),
    table: () => run(editor, c => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true })),
    rule: () => run(editor, c => c.setHorizontalRule()),
    quote: () => run(editor, c => c.toggleBlockquote()),
    bulletList: () => run(editor, c => c.toggleBulletList()),
    orderedList: () => run(editor, c => c.toggleOrderedList()),
    taskList: () => run(editor, c => c.toggleTaskList()),
    bold: () => run(editor, c => c.toggleBold()),
    italic: () => run(editor, c => c.toggleItalic()),
    underline: () => run(editor, c => c.toggleUnderline()),
    code: () => run(editor, c => c.toggleCode()),
    clearFormatting: () => run(editor, c => c.unsetAllMarks()),
    inlineMath: () => insertInlineMath(editor),
    copyPlain: () => copyAsPlainText(editor),
  }
}

export function uxKeymapPlugin(editor: Editor): Plugin {
  const f = formatCommands(editor)
  const bindings: Record<string, () => boolean> = {
    // Save As owns ⌘⇧S. Claim it so StarterKit's strike binding never fires;
    // main.ts's document-level handler still sees the event and saves.
    'Mod-Shift-s': () => true,
    'Mod-Shift-x': f.strike,
    'Mod-Shift-h': f.highlight,
    'Mod-0': f.paragraph,
    'Mod-Alt-t': f.table,
    'Mod-\\': f.clearFormatting,
    'Mod-Shift-m': f.inlineMath,
    // Code block stays on StarterKit's ⌥⌘C; ⇧⌘C is left free for copy.
    'Mod-Alt-Shift-c': f.copyPlain,
  }
  for (const level of [1, 2, 3, 4, 5, 6] as Level[]) {
    bindings[`Mod-${level}`] = () => f.heading(level)
  }
  return keymap(bindings)
}
