import { describe, expect, test } from 'bun:test'
import { selectStartupFiles } from './startup-files'

describe('selectStartupFiles', () => {
  test('prefers files from initialization script when present', () => {
    const result = selectStartupFiles(
      ['/Users/me/initial.md'],
      ['/Users/me/queued.md'],
    )
    expect(result).toEqual(['/Users/me/initial.md'])
  })

  test('falls back to backend queued files when initialization files are empty', () => {
    const result = selectStartupFiles([], ['/Users/me/queued.md'])
    expect(result).toEqual(['/Users/me/queued.md'])
  })

  test('falls back to backend queued files when initialization files are undefined', () => {
    const result = selectStartupFiles(undefined, ['/Users/me/queued.md'])
    expect(result).toEqual(['/Users/me/queued.md'])
  })

  test('returns empty list when neither source has files', () => {
    const result = selectStartupFiles(undefined, [])
    expect(result).toEqual([])
  })
})
