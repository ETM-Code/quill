// Math syntax shared by the parser, serializer, input rules and tests.
//
// Pandoc's dollar rules, so currency stays text: the opening $ needs a
// non-space to its right, the closing $ a non-space to its left and no digit
// to its right. "$50 and $100" and "$50-$100" survive as text; "$E=mc^2$"
// and "$2x+3$" still become math.
export function matchInlineMathToken(src: string): { raw: string; latex: string } | undefined {
  const match = src.match(/^\$([^\s$](?:[^$\n]*[^\s$])?)\$(?![$\d])/)
  if (!match) return undefined
  return { raw: match[0], latex: match[1].trim() }
}

// Digits without any letter or LaTeX command ("50", "3.99", "20,", "5-") are
// prices or plain numbers, not math worth converting while typing.
export function looksLikeCurrency(latex: string): boolean {
  return /^\d/.test(latex) && !/[a-zA-Z\\]/.test(latex)
}

/** Would `$latex$` parse back as exactly this inline math? */
export function dollarSafe(latex: string): boolean {
  const m = matchInlineMathToken(`$${latex}$`)
  return !!m && m.raw.length === latex.length + 2 && m.latex === latex
}
