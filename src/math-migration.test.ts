import { describe, expect, test } from 'bun:test'
import {
  extractBlockMathLatex,
  findFencedBlockMathRanges,
  findInlineMathRanges,
  stripSingleDollarWrappers,
} from './math-migration'

describe('extractBlockMathLatex', () => {
  test('extracts single-line block math', () => {
    expect(extractBlockMathLatex('$$E=mc^2$$')).toBe('E=mc^2')
  })

  test('extracts multiline block math', () => {
    const input = `$$
\\int_0^1 x^2 dx
$$`
    expect(extractBlockMathLatex(input)).toBe('\\int_0^1 x^2 dx')
  })

  test('returns null for inline math', () => {
    expect(extractBlockMathLatex('Price is $5$ today')).toBeNull()
  })

  test('returns null when block delimiters are missing', () => {
    expect(extractBlockMathLatex('E=mc^2')).toBeNull()
  })
})

describe('findFencedBlockMathRanges', () => {
  test('finds fenced block math split across blocks', () => {
    const ranges = findFencedBlockMathRanges([
      'Before',
      '$$',
      '\\int_0^1 x^2 dx',
      '$$',
      'After',
    ])

    expect(ranges).toEqual([
      {
        start: 1,
        end: 3,
        latex: '\\int_0^1 x^2 dx',
      },
    ])
  })

  test('supports multiline latex between fences', () => {
    const ranges = findFencedBlockMathRanges([
      '$$',
      'x = y + z',
      '\\sum_i x_i',
      '$$',
    ])

    expect(ranges).toEqual([
      {
        start: 0,
        end: 3,
        latex: 'x = y + z\n\\sum_i x_i',
      },
    ])
  })

  test('ignores unclosed fences', () => {
    const ranges = findFencedBlockMathRanges([
      '$$',
      'x = y',
      'no close',
    ])
    expect(ranges).toEqual([])
  })
})

describe('findInlineMathRanges', () => {
  test('finds simple inline math', () => {
    expect(findInlineMathRanges('Inline $E=mc^2$ works')).toEqual([
      {
        start: 7,
        end: 15,
        latex: 'E=mc^2',
      },
    ])
  })

  test('ignores block math fences', () => {
    expect(findInlineMathRanges('$$\\int_0^1 x^2 dx$$')).toEqual([])
  })

  test('ignores currency-like $100$', () => {
    expect(findInlineMathRanges('This costs $100$ today')).toEqual([])
  })
})

describe('stripSingleDollarWrappers', () => {
  test('strips one wrapper dollar from each side', () => {
    expect(stripSingleDollarWrappers('Block: $', '$ suffix')).toEqual({
      left: 'Block: ',
      right: ' suffix',
    })
  })

  test('returns null when no leading/trailing dollar pair exists', () => {
    expect(stripSingleDollarWrappers('Block:', '$ suffix')).toBeNull()
    expect(stripSingleDollarWrappers('Block: $', ' suffix')).toBeNull()
  })
})
