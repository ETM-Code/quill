import { describe, expect, test } from 'bun:test'
import { matchInlineMathToken, looksLikeCurrency } from './editor-setup'

// The tokenizer is attempted at every "$" in the source, so a miss at one
// dollar sign only means that dollar sign stays text.
describe('matchInlineMathToken', () => {
  test('parses real inline math', () => {
    expect(matchInlineMathToken('$E=mc^2$ rest')).toEqual({ raw: '$E=mc^2$', latex: 'E=mc^2' })
    expect(matchInlineMathToken('$x$')).toEqual({ raw: '$x$', latex: 'x' })
    expect(matchInlineMathToken('$2x+3$ is linear')).toEqual({ raw: '$2x+3$', latex: '2x+3' })
    expect(matchInlineMathToken('$\\frac{a}{b}$')).toEqual({
      raw: '$\\frac{a}{b}$',
      latex: '\\frac{a}{b}',
    })
  })

  test('leaves currency pairs alone', () => {
    // closing candidate is preceded by a space
    expect(matchInlineMathToken('$50 for lunch and $100 for dinner')).toBeUndefined()
    // closing candidate is followed by a digit
    expect(matchInlineMathToken('$50-$100')).toBeUndefined()
    expect(matchInlineMathToken('$5.99, was $7.99')).toBeUndefined()
  })

  test('leaves a lone price alone', () => {
    expect(matchInlineMathToken('$50 total')).toBeUndefined()
    expect(matchInlineMathToken('$50')).toBeUndefined()
  })

  test('requires non-space adjacent to both delimiters', () => {
    expect(matchInlineMathToken('$ x$')).toBeUndefined()
    expect(matchInlineMathToken('$x $')).toBeUndefined()
  })

  test('round-trips a deliberate numeric math node', () => {
    // renderMarkdown serializes math node "50" as "$50$"; it must re-parse
    expect(matchInlineMathToken('$50$ apples')).toEqual({ raw: '$50$', latex: '50' })
  })

  test('does not eat the opening of block math', () => {
    expect(matchInlineMathToken('$$a+b$$')).toBeUndefined()
    expect(matchInlineMathToken('$a+b$$')).toBeUndefined()
  })

  test('does not span lines', () => {
    expect(matchInlineMathToken('$a\nb$')).toBeUndefined()
  })
})

describe('looksLikeCurrency', () => {
  test('flags prices and number fragments', () => {
    expect(looksLikeCurrency('50')).toBe(true)
    expect(looksLikeCurrency('3.99')).toBe(true)
    expect(looksLikeCurrency('1,000')).toBe(true)
    expect(looksLikeCurrency('20,')).toBe(true)
    expect(looksLikeCurrency('5-')).toBe(true)
  })

  test('lets real math through', () => {
    expect(looksLikeCurrency('2x+3')).toBe(false)
    expect(looksLikeCurrency('50\\%')).toBe(false)
    expect(looksLikeCurrency('x')).toBe(false)
    expect(looksLikeCurrency('\\pi')).toBe(false)
  })
})
