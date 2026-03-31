import { describe, expect, mock, test } from 'bun:test'
import { applyMathEdit, getEditorMenuMode, shouldLazyLoadEditorMenus } from './editor-ui'

describe('applyMathEdit', () => {
  test('updates inline math at an explicit position', () => {
    const updateInlineMath = mock(() => true)
    const updateBlockMath = mock(() => true)

    const applied = applyMathEdit(
      { updateInlineMath, updateBlockMath },
      'inline',
      'E=mc^2',
      12,
    )

    expect(applied).toBe(true)
    expect(updateInlineMath).toHaveBeenCalledWith({ latex: 'E=mc^2', pos: 12 })
    expect(updateBlockMath).not.toHaveBeenCalled()
  })

  test('updates block math at an explicit position', () => {
    const updateInlineMath = mock(() => true)
    const updateBlockMath = mock(() => true)

    const applied = applyMathEdit(
      { updateInlineMath, updateBlockMath },
      'block',
      '\\int_0^1 x^2 dx',
      8,
    )

    expect(applied).toBe(true)
    expect(updateBlockMath).toHaveBeenCalledWith({ latex: '\\int_0^1 x^2 dx', pos: 8 })
    expect(updateInlineMath).not.toHaveBeenCalled()
  })

  test('does not apply when prompt value is empty or null', () => {
    const updateInlineMath = mock(() => true)
    const updateBlockMath = mock(() => true)

    expect(
      applyMathEdit({ updateInlineMath, updateBlockMath }, 'inline', null, 1),
    ).toBe(false)
    expect(
      applyMathEdit({ updateInlineMath, updateBlockMath }, 'inline', '   ', 1),
    ).toBe(false)
    expect(updateInlineMath).not.toHaveBeenCalled()
    expect(updateBlockMath).not.toHaveBeenCalled()
  })
})

describe('shouldLazyLoadEditorMenus', () => {
  test('loads when there is an active text selection', () => {
    expect(
      shouldLazyLoadEditorMenus({
        hasSelectionRange: true,
        isInParagraph: false,
        parentText: '',
        isInTable: false,
      }),
    ).toBe(true)
  })

  test('loads on an empty paragraph for block insert menu', () => {
    expect(
      shouldLazyLoadEditorMenus({
        hasSelectionRange: false,
        isInParagraph: true,
        parentText: '   ',
        isInTable: false,
      }),
    ).toBe(true)
  })

  test('does not load when cursor is in non-empty paragraph and nothing selected', () => {
    expect(
      shouldLazyLoadEditorMenus({
        hasSelectionRange: false,
        isInParagraph: true,
        parentText: 'hello',
        isInTable: false,
      }),
    ).toBe(false)
  })

  test('loads when the cursor is inside a table', () => {
    expect(
      shouldLazyLoadEditorMenus({
        hasSelectionRange: false,
        isInParagraph: true,
        parentText: 'hello',
        isInTable: true,
      }),
    ).toBe(true)
  })
})

describe('getEditorMenuMode', () => {
  test('returns table when cursor is inside a table', () => {
    expect(
      getEditorMenuMode({
        hasSelectionRange: false,
        isInParagraph: true,
        parentText: 'cell',
        isInTable: true,
      }),
    ).toBe('table')
  })

  test('returns insert for an empty paragraph', () => {
    expect(
      getEditorMenuMode({
        hasSelectionRange: false,
        isInParagraph: true,
        parentText: '   ',
        isInTable: false,
      }),
    ).toBe('insert')
  })

  test('returns hidden otherwise', () => {
    expect(
      getEditorMenuMode({
        hasSelectionRange: false,
        isInParagraph: true,
        parentText: 'hello',
        isInTable: false,
      }),
    ).toBe('hidden')
  })
})
