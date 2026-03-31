import { describe, expect, test } from 'bun:test'
import { shouldBlockWindowClose } from './window-close'

describe('shouldBlockWindowClose', () => {
  test('does not block when document is not modified', () => {
    expect(shouldBlockWindowClose(false, false)).toBe(false)
    expect(shouldBlockWindowClose(false, true)).toBe(false)
  })

  test('blocks when document is modified and user does not confirm', () => {
    expect(shouldBlockWindowClose(true, false)).toBe(true)
  })

  test('does not block when document is modified and user confirms', () => {
    expect(shouldBlockWindowClose(true, true)).toBe(false)
  })
})
