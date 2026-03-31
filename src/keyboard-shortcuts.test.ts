import { describe, expect, test } from 'bun:test'
import { getShortcutAction } from './keyboard-shortcuts'

describe('getShortcutAction', () => {
  test('matches find and close shortcuts with command/control modifiers', () => {
    expect(getShortcutAction({ key: 'f', metaKey: true, ctrlKey: false, shiftKey: false }, '')).toBe('find')
    expect(getShortcutAction({ key: 'p', metaKey: true, ctrlKey: false, shiftKey: false }, '')).toBe('print')
    expect(getShortcutAction({ key: 'w', metaKey: true, ctrlKey: false, shiftKey: false }, '')).toBe('closeWindow')
    expect(getShortcutAction({ key: 'w', metaKey: false, ctrlKey: true, shiftKey: false }, '')).toBe('closeWindow')
  })

  test('matches find next and previous only when there is a query', () => {
    expect(getShortcutAction({ key: 'g', metaKey: true, ctrlKey: false, shiftKey: false }, 'term')).toBe('findNext')
    expect(getShortcutAction({ key: 'G', metaKey: true, ctrlKey: false, shiftKey: true }, 'term')).toBe('findPrevious')
    expect(getShortcutAction({ key: 'g', metaKey: true, ctrlKey: false, shiftKey: false }, '')).toBe(null)
  })

  test('returns null when no supported shortcut is pressed', () => {
    expect(getShortcutAction({ key: 'x', metaKey: true, ctrlKey: false, shiftKey: false }, '')).toBe(null)
    expect(getShortcutAction({ key: 'f', metaKey: false, ctrlKey: false, shiftKey: false }, '')).toBe(null)
  })
})
