import { describe, expect, test } from 'bun:test'
import { getFindShortcutMode, shouldCloseFindBarFromDocumentClick } from './find-bar'

describe('getFindShortcutMode', () => {
  test('opens the find bar when it is currently hidden', () => {
    expect(getFindShortcutMode(false)).toBe('open')
  })

  test('closes the find bar when it is already visible', () => {
    expect(getFindShortcutMode(true)).toBe('close')
  })
})

describe('shouldCloseFindBarFromDocumentClick', () => {
  test('closes when the find bar is open and the click is outside it', () => {
    expect(
      shouldCloseFindBarFromDocumentClick({
        isOpen: true,
        clickedInsideFindBar: false,
      }),
    ).toBe(true)
  })

  test('does not close when the click lands inside the find bar', () => {
    expect(
      shouldCloseFindBarFromDocumentClick({
        isOpen: true,
        clickedInsideFindBar: true,
      }),
    ).toBe(false)
  })

  test('does not close when the find bar is already hidden', () => {
    expect(
      shouldCloseFindBarFromDocumentClick({
        isOpen: false,
        clickedInsideFindBar: false,
      }),
    ).toBe(false)
  })
})
