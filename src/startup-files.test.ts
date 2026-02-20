import { describe, expect, test } from 'bun:test'
import { openFirstWorkingStartupFile, selectStartupFiles } from './startup-files'

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

  test('filters empty values and falls back to pending files when needed', () => {
    const result = selectStartupFiles(['', '   '], [' /Users/me/queued.md '])
    expect(result).toEqual(['/Users/me/queued.md'])
  })

  test('deduplicates and trims startup file paths', () => {
    const result = selectStartupFiles(
      [' /Users/me/a.md ', '/Users/me/a.md', '/Users/me/b.md'],
      ['/Users/me/c.md'],
    )
    expect(result).toEqual(['/Users/me/a.md', '/Users/me/b.md'])
  })
})

describe('openFirstWorkingStartupFile', () => {
  test('opens the first working file when earlier candidates fail', async () => {
    const attempted: string[] = []
    const opened = await openFirstWorkingStartupFile(
      ['/Users/me/missing.md', '/Users/me/ok.md'],
      async (path) => path === '/Users/me/ok.md',
      (path) => attempted.push(path),
    )

    expect(opened).toBe('/Users/me/ok.md')
    expect(attempted).toEqual(['/Users/me/missing.md', '/Users/me/ok.md'])
  })

  test('returns null when no startup file can be opened', async () => {
    const opened = await openFirstWorkingStartupFile(
      ['/Users/me/missing.md'],
      async () => false,
    )
    expect(opened).toBeNull()
  })
})
