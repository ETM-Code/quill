// The markdown-it instance Quill parses with: CommonMark + GFM tables,
// strikethrough (~~ only) and autolink literals, plus footnotes, ==highlight==,
// $math$ / \(math\) / $$block$$ / \[block\], and task-list items.
// Front matter is handled by the caller (see splitFrontMatter).
import MarkdownIt from 'markdown-it'
import footnote from 'markdown-it-footnote'
import markPlugin from 'markdown-it-mark'
import type { StateBlock, StateCore, StateInline } from 'markdown-it'
import { matchInlineMathToken } from './math'

function mathInline(state: StateInline, silent: boolean): boolean {
  const src = state.src
  const pos = state.pos
  const ch = src.charCodeAt(pos)
  if (ch === 0x24 /* $ */) {
    // Not after a backslash-escaped context: the escape rule runs later for
    // "\$", but a literal "\" before "$" is consumed by escape first anyway.
    const m = matchInlineMathToken(src.slice(pos, state.posMax))
    if (!m) return false
    if (!silent) {
      const t = state.push('math_inline', 'math', 0)
      t.content = m.latex
      t.markup = '$'
    }
    state.pos += m.raw.length
    return true
  }
  if (ch === 0x5c /* \ */ && src.charCodeAt(pos + 1) === 0x28 /* ( */) {
    const end = src.indexOf('\\)', pos + 2)
    if (end < 0 || end > state.posMax - 2) return false
    const latex = src.slice(pos + 2, end)
    if (!latex.trim()) return false
    if (!silent) {
      const t = state.push('math_inline', 'math', 0)
      t.content = latex.trim()
      t.markup = '\\('
    }
    state.pos = end + 2
    return true
  }
  return false
}

function mathBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  let pos = state.bMarks[startLine] + state.tShift[startLine]
  const max = state.eMarks[startLine]
  if (state.sCount[startLine] - state.blkIndent >= 4) return false
  const first = state.src.slice(pos, max)
  let open: string, close: string
  if (first.startsWith('$$')) { open = '$$'; close = '$$' }
  else if (first.startsWith('\\[')) { open = '\\['; close = '\\]' }
  else return false
  pos += 2
  const rest = state.src.slice(pos, max)
  let latex: string
  let nextLine = startLine
  let multi = false
  const restTrim = rest.trimEnd()
  if (restTrim.length > close.length - 1 && restTrim.endsWith(close) && restTrim.trim() !== close) {
    // Single line: $$x$$ (nothing may follow the closer).
    latex = restTrim.slice(0, -close.length)
    if (!latex.trim()) return false
  } else if (restTrim.trim() === '' || !restTrim.includes(close)) {
    multi = true
    const lines: string[] = rest.trim() ? [rest] : []
    let found = false
    for (nextLine = startLine + 1; nextLine < endLine; nextLine++) {
      const s = state.bMarks[nextLine] + state.tShift[nextLine]
      const e = state.eMarks[nextLine]
      if (s < e && state.sCount[nextLine] < state.blkIndent) break
      const line = state.src.slice(state.bMarks[nextLine] + Math.min(state.tShift[nextLine], state.blkIndent), e)
      const t = line.trimEnd()
      if (t.endsWith(close)) {
        const before = t.slice(0, -close.length)
        if (before.trim()) lines.push(before)
        found = true
        break
      }
      lines.push(line)
    }
    if (!found) return false
    latex = lines.join('\n')
  } else {
    return false
  }
  if (silent) return true
  const token = state.push('math_block', 'math', 0)
  token.block = true
  token.content = multi ? latex.replace(/^\n+|\s+$/g, '') : latex.trim()
  token.markup = open + (multi ? '\n' : '')
  token.map = [startLine, nextLine + 1]
  state.line = nextLine + 1
  return true
}

const TASK_RE = /^\[([ xX])\](?=\s|$)\s?/

/** Mark bullet lists whose every item starts with [ ] / [x] as task lists. */
function taskLists(state: StateCore): void {
  const tokens = state.tokens
  for (let i = 0; i < tokens.length; i++) {
    const list = tokens[i]
    if (list.type !== 'bullet_list_open') continue
    const items: number[] = []
    let depth = 0
    for (let j = i + 1; j < tokens.length; j++) {
      const t = tokens[j]
      if (t.type === 'bullet_list_close' && t.level === list.level) break
      if (t.type === 'list_item_open' && t.level === list.level + 1) items.push(j)
      depth += t.nesting
    }
    if (!items.length) continue
    const ok = items.every(j => {
      const inline = tokens[j + 2]
      return tokens[j + 1]?.type === 'paragraph_open' && inline?.type === 'inline' && TASK_RE.test(inline.content)
    })
    if (!ok) continue
    list.meta = { ...(list.meta ?? {}), task: true }
    for (const j of items) {
      const inline = tokens[j + 2]
      const m = TASK_RE.exec(inline.content)!
      tokens[j].meta = { ...(tokens[j].meta ?? {}), checked: m[1] !== ' ' }
      inline.content = inline.content.slice(m[0].length)
      const first = inline.children?.[0]
      if (first && first.type === 'text') {
        const fm = TASK_RE.exec(first.content)
        if (fm) first.content = first.content.slice(fm[0].length)
        if (!first.content) inline.children!.shift()
      }
    }
  }
}

export function createMarkdownIt(opts: { highlight?: boolean } = {}): MarkdownIt {
  const md = new MarkdownIt('default', { html: true, linkify: true, typographer: false })
  md.linkify.set({ fuzzyLink: false })
  md.use(footnote)
  // Keep footnote definitions where they are written (no tail block), and
  // don't treat ^[inline] as a footnote.
  md.core.ruler.disable('footnote_tail')
  md.inline.ruler.disable('footnote_inline')
  if (opts.highlight !== false) md.use(markPlugin)
  md.inline.ruler.before('escape', 'math_inline', mathInline)
  md.block.ruler.before('fence', 'math_block', mathBlock, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })
  md.core.ruler.push('task_lists', taskLists)
  return md
}

const FRONT_MATTER_RE = /^(---|\+\+\+)[ \t]*\n(?:([\s\S]*?)\n)?(---|\.\.\.|\+\+\+)[ \t]*(?:\n|$)/

/**
 * Split YAML (---) or TOML (+++) front matter off the top of a document.
 * The block must look like key: value data, so a document that merely starts
 * with a thematic break is left alone.
 */
export function splitFrontMatter(src: string): { raw: string; lines: number } | null {
  const m = FRONT_MATTER_RE.exec(src)
  if (!m) return null
  const [, open, body = '', closeMark] = m
  if (open === '+++' ? closeMark !== '+++' : closeMark === '+++') return null
  const firstLine = body.split('\n').find(l => l.trim() && !l.trim().startsWith('#'))
  if (firstLine !== undefined && !/^[\w"'.-][^\n]*?(:|=)(\s|$)/.test(firstLine)) return null
  const raw = m[0].replace(/\n$/, '')
  return { raw, lines: raw.split('\n').length }
}
