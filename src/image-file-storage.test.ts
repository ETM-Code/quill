import { describe, expect, test } from 'bun:test'
import {
  buildImageAssetFilename,
  getImageAssetDirectory,
  getImageMarkdownPath,
} from './image-file-storage'

describe('getImageAssetDirectory', () => {
  test('places assets in a sibling dot-assets directory named after the note', () => {
    expect(getImageAssetDirectory('/Users/eoghancollins/Notes/today.md')).toBe(
      '/Users/eoghancollins/Notes/today.assets',
    )
  })

  test('strips the final extension only', () => {
    expect(getImageAssetDirectory('/Users/eoghancollins/Notes/archive.tar.md')).toBe(
      '/Users/eoghancollins/Notes/archive.tar.assets',
    )
  })
})

describe('buildImageAssetFilename', () => {
  test('sanitizes the original filename and preserves the extension', () => {
    expect(
      buildImageAssetFilename({
        originalName: 'Screenshot 2026-03-18 at 12.30.00 PM.PNG',
        mimeType: 'image/png',
        duplicateIndex: 0,
      }),
    ).toBe('screenshot-2026-03-18-at-12-30-00-pm.png')
  })

  test('falls back to mime type when the clipboard file has no name', () => {
    expect(
      buildImageAssetFilename({
        originalName: '',
        mimeType: 'image/jpeg',
        duplicateIndex: 0,
      }),
    ).toBe('pasted-image.jpg')
  })

  test('adds a numeric suffix when the filename already exists', () => {
    expect(
      buildImageAssetFilename({
        originalName: 'diagram.png',
        mimeType: 'image/png',
        duplicateIndex: 2,
      }),
    ).toBe('diagram-2.png')
  })
})

describe('getImageMarkdownPath', () => {
  test('returns a relative path from the markdown file to the asset', () => {
    expect(
      getImageMarkdownPath(
        '/Users/eoghancollins/Notes/today.md',
        '/Users/eoghancollins/Notes/today.assets/diagram.png',
      ),
    ).toBe('today.assets/diagram.png')
  })
})
