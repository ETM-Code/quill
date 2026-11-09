// Interaction-layer extensions (links, headings, shortcuts, tables, images).
//
// Integration: editor-setup.ts spreads `uxExtensions` into the editor's
// extension list. Everything here except the highlight mark is plain
// ProseMirror plugins, so main.ts can also install them at runtime through
// installUxPlugins() when the editor was built without them (it checks first,
// so wiring both ways never double-registers).
import { Extension, type AnyExtension, type Editor } from '@tiptap/core'
import type { Plugin } from '@tiptap/pm/state'
import { headingIdsPlugin } from './heading-ids'
import { linkHintsPlugin } from './link-hints'
import { uxKeymapPlugin } from './keymap'
import { tableControlsPlugins } from './table-controls'
import { Highlight } from './highlight'
import { imageInteractionsPlugin } from './image-interactions'

export { slugify, findHeadingBySlug, collectHeadings, type HeadingInfo } from './heading-ids'
export { setImageHandlers } from './image-interactions'
export { formatCommands } from './keymap'
export { insertInlineMath, setInlineMathHandler } from './math-insert'
export { copyAsPlainText, selectionPlainText, fragmentText } from './plain-text'

/** Every ProseMirror plugin the UX layer contributes. */
export function uxPlugins(editor: Editor): Plugin[] {
  return [
    uxKeymapPlugin(editor),
    headingIdsPlugin(),
    linkHintsPlugin(),
    imageInteractionsPlugin(),
    ...tableControlsPlugins(editor),
  ]
}

const UX_EXTENSION_NAME = 'quillUx'

/**
 * Priority above StarterKit (100) so the UX keymap runs before the stock
 * bindings (e.g. ⌘⇧S belongs to Save As, not strikethrough).
 */
export const QuillUx = Extension.create({
  name: UX_EXTENSION_NAME,
  priority: 1000,
  addProseMirrorPlugins() {
    return uxPlugins(this.editor)
  },
})

export const uxExtensions: AnyExtension[] = [QuillUx, Highlight]

/**
 * Install the UX plugins on an editor that was created without uxExtensions.
 * No-op when the extension is already part of the editor. Plugins are
 * prepended so their keymaps take precedence over the stock ones.
 */
export function installUxPlugins(editor: Editor): boolean {
  const present = editor.extensionManager.extensions.some(e => e.name === UX_EXTENSION_NAME)
  if (present) return false
  for (const plugin of uxPlugins(editor).reverse()) {
    editor.registerPlugin(plugin, (p, plugins) => [p, ...plugins])
  }
  return true
}

/** True when the highlight mark is part of the schema (needs uxExtensions wired). */
export function hasHighlight(editor: Editor): boolean {
  return !!editor.schema.marks.highlight
}
