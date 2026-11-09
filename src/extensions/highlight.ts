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

// ==x== with no space just inside either delimiter, not part of a longer run
// of "=" (so "a === b" and "x == y" stay text).
const HIGHLIGHT_RE = /^==(?!=)(?=\S)([^\n]*?\S)==(?!=)/

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

  // Read at runtime by @tiptap/markdown.
  ...({
    markdownTokenName: 'highlight',
    markdownTokenizer: {
      name: 'highlight',
      level: 'inline',
      start: (src: string) => src.indexOf('=='),
      tokenize: (src: string, _tokens: unknown, helper: { inlineTokens: (s: string) => unknown[] }) => {
        const m = HIGHLIGHT_RE.exec(src)
        if (!m) return undefined
        return { type: 'highlight', raw: m[0], text: m[1], tokens: helper.inlineTokens(m[1]) }
      },
    },
    parseMarkdown: (token: { tokens?: unknown[] }, helpers: any) =>
      helpers.applyMark('highlight', helpers.parseInline(token.tokens || [])),
    renderMarkdown: (node: unknown, h: any) => `==${h.renderChildren(node)}==`,
  } as object),
})
