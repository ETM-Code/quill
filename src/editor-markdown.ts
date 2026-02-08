type EditorLike = {
  getHTML: () => string
  getMarkdown?: () => string
  storage?: {
    markdown?: {
      getMarkdown?: () => string
      setMarkdown?: (markdown: string) => void
    }
  }
  commands: {
    setContent: (content: string, options?: { contentType?: 'markdown' }) => void
  }
}

export function getMarkdownFromEditor(editor: EditorLike): string {
  // Preferred API in @tiptap/markdown v3
  if (typeof editor.getMarkdown === 'function') {
    return editor.getMarkdown()
  }

  // Backward compatibility if a plugin provided a storage getter
  if (editor.storage?.markdown?.getMarkdown) {
    return editor.storage.markdown.getMarkdown()
  }

  // Last resort fallback
  return editor.getHTML()
}

export function setMarkdownInEditor(editor: EditorLike, markdown: string): void {
  // Backward compatibility if a plugin provided a storage setter
  if (editor.storage?.markdown?.setMarkdown) {
    editor.storage.markdown.setMarkdown(markdown)
    return
  }

  // Required for @tiptap/markdown to parse markdown instead of treating as HTML/text
  editor.commands.setContent(markdown, { contentType: 'markdown' })
}
