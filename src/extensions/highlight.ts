// ==highlight== mark (Obsidian/Typora/markdown-it-mark syntax), ⌘⇧H.
// Renders as <mark>; round-trips as ==text==. Needs to be in the schema, so it
// only exists when uxExtensions is wired into the editor (not via the runtime
// plugin fallback).
import { Mark, mergeAttributes } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    quillHighlight: {
      toggleHighlight: () => ReturnType
    }
  }
}

export const Highlight = Mark.create({
  name: 'highlight',

  parseHTML() {
    return [{ tag: 'mark' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['mark', mergeAttributes(HTMLAttributes), 0]
  },

  addCommands() {
    return {
      toggleHighlight:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
    }
  },

  // Markdown (==x==) is parsed by markdown-it-mark and written by src/markdown.
})
