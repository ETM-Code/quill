import { describe, expect, test } from 'bun:test'
import { getMarkdownPasteContent, looksLikeMarkdown } from './markdown-paste'

type ClipboardMap = Record<string, string>

function makeClipboardEvent(values: ClipboardMap): ClipboardEvent {
  const clipboardData = {
    getData: (type: string) => values[type] ?? '',
  } as DataTransfer

  return { clipboardData } as ClipboardEvent
}

describe('markdown paste detection', () => {
  test('looksLikeMarkdown detects block markdown', () => {
    expect(looksLikeMarkdown('# Title\n\n- item')).toBe(true)
  })

  test('looksLikeMarkdown detects inline markdown', () => {
    expect(looksLikeMarkdown('use **bold** here')).toBe(true)
  })

  test('looksLikeMarkdown ignores plain text', () => {
    expect(looksLikeMarkdown('hello world')).toBe(false)
  })
})

describe('getMarkdownPasteContent', () => {
  test('prefers text/markdown clipboard payload', () => {
    const event = makeClipboardEvent({
      'text/markdown': '## Heading',
      'text/plain': 'Heading',
      'text/html': '<h2>Heading</h2>',
    })

    expect(getMarkdownPasteContent(event)).toBe('## Heading')
  })

  test('uses plain text when no html is present', () => {
    const event = makeClipboardEvent({
      'text/plain': '# Heading',
    })

    expect(getMarkdownPasteContent(event)).toBe('# Heading')
  })

  test('uses plain text when html exists but plain text looks like markdown', () => {
    const event = makeClipboardEvent({
      'text/plain': '- item',
      'text/html': '<p>- item</p>',
    })

    expect(getMarkdownPasteContent(event)).toBe('- item')
  })

  test('falls back to default paste behavior for non-markdown rich text', () => {
    const event = makeClipboardEvent({
      'text/plain': 'hello world',
      'text/html': '<p><strong>hello world</strong></p>',
    })

    expect(getMarkdownPasteContent(event)).toBeNull()
  })

  test('falls back to default paste behavior for VS Code payloads', () => {
    const event = makeClipboardEvent({
      'text/plain': 'const x = 1',
      'vscode-editor-data': '{"mode":"typescript"}',
    })

    expect(getMarkdownPasteContent(event)).toBeNull()
  })
})
