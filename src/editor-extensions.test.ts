import { describe, expect, test } from 'bun:test'
import { Editor } from '@tiptap/core'
import { buildExtensions } from './editor-extensions'

describe('buildExtensions', () => {
  test('round-trips markdown task lists', () => {
    const editor = new Editor({
      extensions: buildExtensions({
        codeBlockLowlightExtension: null,
        uiMenuExtensions: null,
        onInlineMathClick: () => {},
        onBlockMathClick: () => {},
      }),
      content: '- [ ] Ship task list support\n- [x] Keep markdown round-tripping\n',
      contentType: 'markdown',
    })

    expect(editor.getMarkdown()).toContain('- [ ] Ship task list support')
    expect(editor.getMarkdown()).toContain('- [x] Keep markdown round-tripping')

    editor.destroy()
  })
})
