// Shared pieces of the markdown fidelity gate: the independent oracle
// (markdown-it, CommonMark + GFM tables/strike/autolinks, raw HTML on) and the
// normalisations Quill is allowed to make when it rewrites edited markdown.
import MarkdownIt from 'markdown-it'

const oracle = new MarkdownIt('default', { html: true, linkify: true, typographer: false })
oracle.linkify.set({ fuzzyLink: false })

/**
 * Allowed normalisations (rendered-HTML level). Anything else that changes the
 * oracle's HTML is a meaning change.
 *  - whitespace between tags / runs of whitespace
 *  - <br> spellings
 *  - <b>/<i>/<del>/<strike>/<ins> written as **, *, ~~, <u> (same rendering)
 *  - nesting order of marks covering exactly the same text (<s><strong>x vs
 *    <strong><s>x)
 *  - ordered-list numbering 1. 1. 1. -> 1. 2. 3. and 1) -> 1. (same HTML)
 *  - indented code -> fenced, setext -> ATX, * / + bullets -> -, hr style,
 *    \ vs two-space hard breaks, entity -> character (all identical HTML)
 */
const INLINE_TAGS = 'strong|em|s|u|mark|sub|sup|kbd|a'
const NESTED_PAIR = new RegExp(`<(${INLINE_TAGS})((?: [^>]*)?)><(${INLINE_TAGS})((?: [^>]*)?)>([^<]*)</\\3></\\1>`, 'g')

/** Marks covering exactly the same text may nest either way round. */
function canonicalNesting(html: string): string {
  let prev = ''
  while (prev !== html) {
    prev = html
    html = html.replace(NESTED_PAIR, (m, a, aa, b, ba, text) =>
      a <= b ? m : `<${b}${ba}><${a}${aa}>${text}</${a}></${b}>`)
  }
  return html
}

export function normHtml(html: string): string {
  return canonicalNesting(html)
    .replace(/<br\s*\/?>/g, '<br>')
    .replace(/<(\/?)b>/g, '<$1strong>')
    .replace(/<(\/?)i>/g, '<$1em>')
    .replace(/<(\/?)(del|strike)>/g, '<$1s>')
    .replace(/<(\/?)ins>/g, '<$1u>')
    .replace(/\s+/g, ' ')
    .replace(/> </g, '><')
    .replace(/ ?<br> ?/g, '<br>')
    .trim()
}

export function render(md: string): string {
  return oracle.render(md.replace(/\r\n?/g, '\n'))
}

export function sameMeaning(a: string, b: string): boolean {
  return normHtml(render(a)) === normHtml(render(b))
}

/** First differing window of two normalised renders, for reports. */
export function diffHint(a: string, b: string): string {
  const x = normHtml(render(a)), y = normHtml(render(b))
  let i = 0
  while (i < x.length && x[i] === y[i]) i++
  return `@${i}\n      in : ${JSON.stringify(x.slice(Math.max(0, i - 60), i + 80))}\n      out: ${JSON.stringify(y.slice(Math.max(0, i - 60), i + 80))}`
}

// Constructs the oracle can't judge (it doesn't know them, or they need the
// exact text): checked against an exact expected save after a fresh
// serialisation (no source preservation).
export const EXACT: Array<[id: string, input: string, expected: string]> = [
  ['footnote', 'Text with note[^1] and another[^long].\n\n[^1]: The footnote.\n[^long]: Multi\n    line.\n',
    'Text with note[^1] and another[^long].\n\n[^1]: The footnote.\n[^long]: Multi\n    line.\n'],
  ['frontmatter', '---\ntitle: Hello\ntags: [a, b]\ndate: 2026-01-01\n---\n\n# Body\n',
    '---\ntitle: Hello\ntags: [a, b]\ndate: 2026-01-01\n---\n\n# Body\n'],
  ['frontmatter-toml', '+++\ntitle = "x"\n+++\n\ntext\n', '+++\ntitle = "x"\n+++\n\ntext\n'],
  ['alert-note', '> [!NOTE]\n> Useful information.\n\n> [!WARNING]\n> Danger.\n',
    '> [!NOTE]\n> Useful information.\n\n> [!WARNING]\n> Danger.\n'],
  ['obsidian-callout', '> [!faq]- Folded\n> hidden\n', '> [!faq]- Folded\n> hidden\n'],
  ['highlight', 'a ==highlighted== b\n', 'a ==highlighted== b\n'],
  ['math-inline', 'inline $E=mc^2$ and $a_b$ and \\(x^2\\)\n', 'inline $E=mc^2$ and $a_b$ and \\(x^2\\)\n'],
  ['math-block', '$$\n\\int_0^1 x\\,dx\n$$\n', '$$\n\\int_0^1 x\\,dx\n$$\n'],
  ['math-block-oneline', '$$x^2 + y^2$$\n', '$$x^2 + y^2$$\n'],
  ['math-currency', 'costs $5 and $10, or $5-$10\n', 'costs $5 and $10, or $5-$10\n'],
  ['details', '<details>\n<summary>Click</summary>\n\nHidden **content**\n\n</details>\n',
    '<details>\n<summary>Click</summary>\n\nHidden **content**\n\n</details>\n'],
  ['task-list', '- [ ] todo\n- [x] done\n  - [ ] nested\n', '- [ ] todo\n- [x] done\n  - [ ] nested\n'],
  ['sub-sup-kbd', 'H<sub>2</sub>O, x<sup>2</sup>, <kbd>Ctrl</kbd>\n', 'H<sub>2</sub>O, x<sup>2</sup>, <kbd>Ctrl</kbd>\n'],
  ['underline', 'text <u>underlined</u> text\n', 'text <u>underlined</u> text\n'],
  ['softbreak', 'line one\nline two\n', 'line one\nline two\n'],
  ['mermaid', '```mermaid\ngraph TD\n  A-->B\n```\n', '```mermaid\ngraph TD\n  A-->B\n```\n'],
  ['tilde-fence', '~~~js\nconst a = 1\n~~~\n', '~~~js\nconst a = 1\n~~~\n'],
  ['angle-placeholder', 'Replace <API_KEY> with your key. Press <Enter>.\n', 'Replace <API_KEY> with your key. Press <Enter>.\n'],
]
