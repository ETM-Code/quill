const MARKDOWN_MIME_TYPES = ['text/markdown', 'text/x-markdown']

function hasValue(value: string): boolean {
  return value.trim().length > 0
}

export function looksLikeMarkdown(text: string): boolean {
  const value = text.trim()
  if (!value) {
    return false
  }

  const blockPatterns = [
    /^\s{0,3}#{1,6}\s+\S/m,
    /^\s{0,3}>\s+\S/m,
    /^\s{0,3}[-+*]\s+\S/m,
    /^\s{0,3}\d+[.)]\s+\S/m,
    /^\s{0,3}```/m,
    /^\s{0,3}~~~/m,
    /^\s{0,3}\|.+\|/m,
  ]

  if (blockPatterns.some((pattern) => pattern.test(value))) {
    return true
  }

  const inlinePattern = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|~~[^~\n]+~~|\[[^\]\n]+\]\([^)]+\))/g
  const matches = value.match(inlinePattern)
  return (matches?.length ?? 0) >= 1
}

export function getMarkdownPasteContent(event: ClipboardEvent): string | null {
  const data = event.clipboardData
  if (!data) {
    return null
  }

  for (const mimeType of MARKDOWN_MIME_TYPES) {
    const markdown = data.getData(mimeType)
    if (hasValue(markdown)) {
      return markdown
    }
  }

  // Let Tiptap's VS Code paste handler create language-aware code blocks.
  if (hasValue(data.getData('vscode-editor-data'))) {
    return null
  }

  const plain = data.getData('text/plain')
  if (!hasValue(plain)) {
    return null
  }

  const html = data.getData('text/html')
  if (!hasValue(html)) {
    return plain
  }

  return looksLikeMarkdown(plain) ? plain : null
}
