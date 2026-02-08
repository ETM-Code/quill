import { describe, expect, mock, test } from 'bun:test'
import { getMarkdownFromEditor, setMarkdownInEditor } from './editor-markdown'

describe('editor markdown bridge', () => {
  test('getMarkdownFromEditor uses editor.getMarkdown when available', () => {
    const editor = {
      getMarkdown: () => '# from api',
      getHTML: () => '<p>fallback</p>',
      commands: { setContent: () => {} },
    }

    expect(getMarkdownFromEditor(editor)).toBe('# from api')
  })

  test('getMarkdownFromEditor falls back to storage getter when needed', () => {
    const editor = {
      getHTML: () => '<p>fallback</p>',
      storage: {
        markdown: {
          getMarkdown: () => '# from storage',
        },
      },
      commands: { setContent: () => {} },
    }

    expect(getMarkdownFromEditor(editor)).toBe('# from storage')
  })

  test('getMarkdownFromEditor falls back to HTML as last resort', () => {
    const editor = {
      getHTML: () => '<p>fallback</p>',
      commands: { setContent: () => {} },
    }

    expect(getMarkdownFromEditor(editor)).toBe('<p>fallback</p>')
  })

  test('setMarkdownInEditor uses storage setter when available', () => {
    const setMarkdown = mock(() => {})
    const setContent = mock(() => {})
    const editor = {
      getHTML: () => '',
      storage: {
        markdown: {
          setMarkdown,
        },
      },
      commands: { setContent },
    }

    setMarkdownInEditor(editor, '# hello')

    expect(setMarkdown).toHaveBeenCalledWith('# hello')
    expect(setContent).not.toHaveBeenCalled()
  })

  test('setMarkdownInEditor uses setContent with markdown contentType', () => {
    const setContent = mock(() => {})
    const editor = {
      getHTML: () => '',
      commands: { setContent },
    }

    setMarkdownInEditor(editor, '# hello')

    expect(setContent).toHaveBeenCalledWith('# hello', { contentType: 'markdown' })
  })
})
