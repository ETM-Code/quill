import { describe, expect, test } from 'bun:test'
import { splitMarkdownForParsing, looksLikeMarkdown, canonicalLanguage } from './editor-setup'

function rejoin(chunks: string[]): string {
  return chunks.join('\n')
}

describe('splitMarkdownForParsing', () => {
  test('rejoining chunks reproduces the input exactly', () => {
    const md = ['# T', '', ...Array.from({ length: 600 }, (_, i) => `para ${i}\n`)].join('\n')
    const chunks = splitMarkdownForParsing(md)
    expect(chunks.length).toBeGreaterThan(1)
    expect(rejoin(chunks)).toBe(md)
  })

  test('never splits inside a code fence', () => {
    const fenceBody = Array.from({ length: 300 }, (_, i) => `code line ${i}`).join('\n\n')
    const md = `intro\n\n\`\`\`js\n${fenceBody}\n\`\`\`\n\nafter\n`
    const chunks = splitMarkdownForParsing(md)
    for (const chunk of chunks) {
      const fences = (chunk.match(/^\s{0,3}`{3,}/gm) ?? []).length
      expect(fences % 2).toBe(0)
    }
    expect(rejoin(chunks)).toBe(md)
  })

  test('does not split before list continuations or quotes or tables', () => {
    const block = 'text\n\n- item a\n\n- loose item b\n\n> quote\n\n| a |\n|---|\n'
    const md = block.repeat(120)
    const chunks = splitMarkdownForParsing(md)
    expect(rejoin(chunks)).toBe(md)
    // no chunk may START with a continuation-looking line
    for (const chunk of chunks.slice(1)) {
      const firstNonEmpty = chunk.split('\n').find(l => l.trim() !== '') ?? ''
      expect(/^(\s|[-*+>|]|\d+[.)])/.test(firstNonEmpty)).toBe(false)
    }
  })

  test('small inputs come back as one chunk', () => {
    expect(splitMarkdownForParsing('# small\n\ntext\n')).toHaveLength(1)
  })
})

describe('looksLikeMarkdown', () => {
  test('detects markdown constructs', () => {
    expect(looksLikeMarkdown('# Heading\n\nbody')).toBe(true)
    expect(looksLikeMarkdown('some **bold** here')).toBe(true)
    expect(looksLikeMarkdown('- a\n- b\n')).toBe(true)
    expect(looksLikeMarkdown('[x](https://y.z)')).toBe(true)
  })

  test('leaves plain text alone', () => {
    expect(looksLikeMarkdown('just a sentence with 5 * 3 math')).toBe(false)
    expect(looksLikeMarkdown('one line')).toBe(false)
  })
})

describe('canonicalLanguage', () => {
  test('maps aliases', () => {
    expect(canonicalLanguage('js')).toBe('javascript')
    expect(canonicalLanguage('PY')).toBe('python')
    expect(canonicalLanguage('plaintext')).toBe('')
    expect(canonicalLanguage('nonexistent-lang')).toBe('')
    expect(canonicalLanguage(null)).toBe('')
  })
})
