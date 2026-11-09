// ProseMirror document -> markdown.
//
// The writer state (block delimiters, closing blocks, the inline mark stack
// with mixable-mark reordering and whitespace expulsion) is adapted from
// prosemirror-markdown's MarkdownSerializerState (MIT, (c) Marijn Haverbeke
// and others). Quill-specific parts: escaping that is exact for markdown-it
// (instead of escaping every punctuation character), per-item list
// indentation, soft breaks, tables, footnotes, raw HTML, front matter, and
// reuse of the original source for anything unedited (see source.ts).
import type { Mark, Node as PMNode } from '@tiptap/pm/model'
import type LinkifyIt from 'linkify-it'
import { dollarSafe, matchInlineMathToken } from './math'
import { blockSourceOf, inlineSources, type LoadInfo } from './source'

export interface SerializeOptions {
  /** Reuse original source for unedited blocks and lines (default true). */
  preserve?: boolean
  /** The load whose separators / head / tail apply. */
  load?: LoadInfo | null
  linkify?: LinkifyIt
}

type Ctx = 'block' | 'cell' | 'heading'

// Outermost first. Code is innermost so its content is written raw.
const MARK_ORDER = ['link', 'bold', 'italic', 'strike', 'highlight', 'underline', 'subscript', 'superscript', 'kbd', 'code']
const markRank = (m: Mark) => {
  const i = MARK_ORDER.indexOf(m.type.name)
  return i < 0 ? MARK_ORDER.length - 1 : i
}

interface MarkSpec {
  open: string | ((s: Writer, mark: Mark, parent: PMNode, index: number) => string)
  close: string | ((s: Writer, mark: Mark, parent: PMNode, index: number) => string)
  mixable?: boolean
  expel?: boolean
  /** HTML tag to fall back to when delimiters wouldn't flank. */
  html?: string
  noEscape?: boolean
}

const ASCII_PUNCT = /[!-/:-@[-`{-~]/
// What markdown-it would read as raw HTML or an autolink at a "<".
const HTMLISH = new RegExp('^(?:' + [
  '<[A-Za-z][A-Za-z0-9-]*(?:\\s+[A-Za-z_:][\\w.:-]*(?:\\s*=\\s*(?:[^\\s"\'=<>`]+|\'[^\']*\'|"[^"]*"))?)*\\s*/?>',
  '</[A-Za-z][A-Za-z0-9-]*\\s*>',
  '<!--', '<\\?', '<![A-Za-z]', '<!\\[CDATA\\[',
  '<[A-Za-z][A-Za-z0-9.+-]{1,31}:[^\\s<>]*>',
  '<[^\\s<>@]+@[^\\s<>]+>',
].join('|') + ')')

function backticksFor(text: string): { fence: string; pad: boolean } {
  const runs = text.match(/`+/g) ?? []
  const lens = new Set(runs.map(r => r.length))
  let n = 1
  while (lens.has(n)) n++
  const pad = /^`|`$/.test(text) || (/^ /.test(text) && / $/.test(text) && /[^ ]/.test(text))
  return { fence: '`'.repeat(n), pad }
}

function isPlainUrl(mark: Mark, parent: PMNode, index: number): string | null {
  const child = parent.child(index)
  if (!child.isText || !child.text) return null
  const next = index + 1 < parent.childCount ? parent.child(index + 1) : null
  if (next && mark.isInSet(next.marks)) return null
  const prev = index > 0 ? parent.child(index - 1) : null
  if (prev && mark.isInSet(prev.marks)) return null
  if (child.marks.length !== 1) return null
  return child.text
}

export class Writer {
  out = ''
  delim = ''
  closed: PMNode | null = null
  atLineStart = false
  inAutolink = false
  ctx: Ctx = 'block'
  /** Effective bullet / delimiter used for each list rendered so far. */
  listMarker = new WeakMap<PMNode, string>()

  constructor(readonly opts: SerializeOptions) {}

  get preserve(): boolean {
    return this.opts.preserve !== false
  }

  // --- block plumbing (prosemirror-markdown) ---

  flushClose(size = 2): void {
    if (this.closed) {
      if (!this.atBlank()) this.out += '\n'
      if (size > 1) {
        const delimMin = this.delim.replace(/\s+$/, '')
        for (let i = 1; i < size; i++) this.out += delimMin + '\n'
      }
      this.closed = null
    }
  }

  atBlank(): boolean {
    return /(^|\n)$/.test(this.out)
  }

  ensureNewLine(): void {
    if (!this.atBlank()) this.out += '\n'
  }

  write(content?: string): void {
    this.flushClose()
    if (this.delim && this.atBlank()) this.out += this.delim
    if (content) this.out += content
  }

  closeBlock(node: PMNode): void {
    this.closed = node
  }

  wrapBlock(delim: string, firstDelim: string | null, node: PMNode, f: () => void): void {
    const old = this.delim
    this.write(firstDelim ?? delim)
    this.delim += delim
    f()
    this.delim = old
    this.closeBlock(node)
  }

  /** Write raw lines, each prefixed with the current delimiter. */
  lines(text: string): void {
    const ls = text.split('\n')
    for (let i = 0; i < ls.length; i++) {
      this.write()
      // A blank line inside a block keeps the (trimmed) container prefix.
      if (!ls[i] && this.out.endsWith(this.delim) && this.delim) {
        this.out = this.out.slice(0, this.out.length - this.delim.length) + this.delim.replace(/\s+$/, '')
      }
      this.out += ls[i]
      if (i !== ls.length - 1) this.out += '\n'
    }
  }

  // --- blocks ---

  renderContent(parent: PMNode): void {
    let prev: PMNode | null = null
    parent.forEach((child, _, i) => {
      if (isEmptyParagraph(child) && parent.type.name !== 'tableCell' && parent.type.name !== 'tableHeader') {
        return
      }
      // Consecutive footnote definitions sit on consecutive lines.
      if (prev?.type.name === 'footnoteDef' && child.type.name === 'footnoteDef') this.flushClose(1)
      this.render(child, parent, i, prev)
      prev = child
    })
  }

  render(node: PMNode, parent: PMNode, index: number, prev: PMNode | null = null): void {
    const fn = NODES[node.type.name]
    if (fn) fn(this, node, parent, index, prev)
    else if (node.isTextblock) {
      this.renderInline(node)
      this.closeBlock(node)
    } else if (!node.isLeaf) {
      this.renderContent(node)
      this.closeBlock(node)
    } else {
      this.write(node.textContent)
      this.closeBlock(node)
    }
  }

  /** Paragraph-like content: reuse the original inline source when unedited. */
  textblock(node: PMNode, ctx: Ctx = this.ctx): void {
    const src = this.preserve ? inlineSources.get(node) : undefined
    const srcCtx = ctx === 'cell' ? 'cell' : 'block'
    if (src && src.ctx === srcCtx && (ctx !== 'heading' || !src.src.includes('\n'))) {
      this.lines(src.src)
      return
    }
    const old = this.ctx
    this.ctx = ctx
    this.renderInline(node)
    this.ctx = old
  }

  listMarkerFor(node: PMNode, prev: PMNode | null): string {
    const family = (n: PMNode | null) => (n ? (n.type.name === 'orderedList' ? 'ol' : /^(bulletList|taskList)$/.test(n.type.name) ? 'ul' : null) : null)
    const fam = family(node)
    let marker: string
    if (fam === 'ol') marker = node.attrs.mdDelim === ')' ? ')' : '.'
    else marker = typeof node.attrs.mdBullet === 'string' && /^[-*+]$/.test(node.attrs.mdBullet) ? node.attrs.mdBullet : '-'
    const prevMarker = prev && family(prev) === fam ? this.listMarker.get(prev) : undefined
    if (prevMarker === marker) {
      marker = fam === 'ol' ? (marker === '.' ? ')' : '.') : marker === '-' ? '*' : '-'
    }
    this.listMarker.set(node, marker)
    return marker
  }

  renderList(node: PMNode, prev: PMNode | null, firstDelim: (i: number, marker: string) => string, extra?: (i: number) => string): void {
    const marker = this.listMarkerFor(node, prev)
    const tight = listIsTight(node)
    node.forEach((child, _, i) => {
      if (i && tight) this.flushClose(1)
      else if (i && !tight) this.flushClose(2)
      const first = firstDelim(i, marker)
      this.wrapBlock(' '.repeat(first.length), first + (extra?.(i) ?? ''), node, () => {
        this.renderItem(child, tight)
      })
    })
  }

  renderItem(item: PMNode, tight: boolean): void {
    let prev: PMNode | null = null
    let first = true
    item.forEach((child, _, i) => {
      if (isEmptyParagraph(child)) return
      if (!first) this.flushClose(tight ? 1 : 2)
      this.render(child, item, i, prev)
      prev = child
      first = false
    })
  }

  // --- inline (prosemirror-markdown's algorithm, with Quill's marks) ---

  renderInline(parent: PMNode): void {
    this.atLineStart = true
    const active: Mark[] = []
    let trailing = ''
    const nodes: PMNode[] = []
    parent.forEach(n => nodes.push(n))
    // Breaks at the end of a block have no meaning in markdown.
    while (nodes.length && /^(hardBreak|softBreak)$/.test(nodes[nodes.length - 1].type.name)) nodes.pop()

    const n = nodes.length
    const runEnd = (i: number, m: Mark) => {
      let j = i
      while (j + 1 < n && m.isInSet(nodes[j + 1].marks)) j++
      return j
    }
    const activeHtml: boolean[] = []
    // Order a node's marks: code innermost, then the mark that runs further
    // outermost (so **[link](u)** keeps bold outside), then a fixed rank.
    const ordered = (node: PMNode, i: number) => [...node.marks]
      .map(m => ({ m, end: runEnd(i, m), code: m.type.name === 'code' ? 1 : 0 }))
      .sort((a, b) => a.code - b.code || b.end - a.end || markRank(a.m) - markRank(b.m))
      .map(x => x.m)

    const progress = (node: PMNode | null, index: number) => {
      let marks: Mark[] = node ? ordered(node, index) : []
      if (node && /^(hardBreak|softBreak)$/.test(node.type.name)) {
        // Close marks around a line break that don't continue after it.
        marks = marks.filter(m => index + 1 < nodes.length && m.isInSet(nodes[index + 1].marks))
      }
      let leading = trailing
      trailing = ''
      if (node && node.isText && marks.some(m => spec(m).expel && !m.isInSet(active))) {
        const [, lead, rest] = /^(\s*)([\s\S]*)$/.exec(node.text!)!
        if (lead) {
          leading += lead
          node = rest ? node.type.schema.text(rest, node.marks) : null
          if (!node) marks = active
        }
      }
      if (node && node.isText && marks.some(m => spec(m).expel && !this.isMarkAhead(nodes, index + 1, m))) {
        const [, rest, trail] = /^([\s\S]*?)(\s*)$/.exec(node.text!)!
        if (trail) {
          trailing = trail
          node = rest ? node.type.schema.text(rest, node.marks) : null
          if (!node) marks = active
        }
      }
      const inner = marks.length ? marks[marks.length - 1] : null
      const noEsc = !!inner && spec(inner).noEscape === true
      const len = marks.length - (noEsc ? 1 : 0)
      outer: for (let i = 0; i < len; i++) {
        const mark = marks[i]
        if (!spec(mark).mixable) break
        for (let j = 0; j < active.length; j++) {
          const other = active[j]
          if (!spec(other).mixable) break
          if (mark.eq(other)) {
            if (i > j) marks = marks.slice(0, j).concat(mark).concat(marks.slice(j, i)).concat(marks.slice(i + 1, len))
            else if (j > i) marks = marks.slice(0, i).concat(marks.slice(i + 1, j)).concat(mark).concat(marks.slice(j, len))
            continue outer
          }
        }
      }
      let keep = 0
      while (keep < Math.min(active.length, len) && marks[keep].eq(active[keep])) ++keep
      while (keep < active.length) {
        const html = activeHtml.pop()!
        this.raw(this.markString(active.pop()!, false, parent, index, html))
      }
      if (leading) this.text(leading)
      if (node) {
        while (active.length < len) {
          const add = marks[active.length]
          const html = this.needsHtml(add, nodes, index, runEnd(index, add), marks.slice(active.length + 1))
          active.push(add)
          activeHtml.push(html)
          this.raw(this.markString(add, true, parent, index, html))
        }
        if (noEsc && node.isText) {
          this.code(node.text!)
        } else {
          this.inlineNode(node, parent, index)
        }
      }
    }
    nodes.forEach((n, i) => progress(n, i))
    progress(null, nodes.length)
    this.atLineStart = false
  }

  /**
   * Delimiter marks (** * ~~ ==) only work when the delimiters are left- and
   * right-flanking. When they wouldn't be (e.g. **"quoted"**word), write the
   * span as an HTML tag instead.
   */
  needsHtml(mark: Mark, nodes: PMNode[], start: number, end: number, innerMarks: Mark[]): boolean {
    const sp = spec(mark)
    if (!sp.html) return false
    if (mark.attrs.mdTag) return true
    const ws = (c: string) => c === '' || /\s/.test(c)
    const punct = (c: string) => /[\p{P}\p{S}]/u.test(c)
    const first = nodes[start]
    const last = nodes[end]
    const prevChar = this.atLineStart || this.atBlank() ? ' ' : this.out.slice(-1)
    // Inner marks opening right after this one write punctuation first.
    const firstChar = first.isText && innerMarks.length === 0 ? first.text!.trimStart()[0] ?? ' ' : '!'
    const lastInner = last.marks.some(m => m !== mark && !m.eq(mark) && (spec(m).noEscape || runEndOf(nodes, end, m) === end))
    let lastChar = '!'
    let nextChar = ' '
    if (last.isText && !lastInner) {
      const t = last.text!
      lastChar = t.trimEnd().slice(-1) || ' '
      if (/\s$/.test(t)) nextChar = ' '
      else nextChar = nextCharAfter(nodes, end)
    } else {
      nextChar = nextCharAfter(nodes, end)
    }
    const leftOk = !ws(firstChar) && (!punct(firstChar) || ws(prevChar) || punct(prevChar))
    const rightOk = !ws(lastChar) && (!punct(lastChar) || ws(nextChar) || punct(nextChar))
    return !(leftOk && rightOk)
  }

  isMarkAhead(nodes: PMNode[], index: number, mark: Mark): boolean {
    for (; index < nodes.length; index++) {
      const next = nodes[index]
      if (!/^(hardBreak|softBreak)$/.test(next.type.name)) return mark.isInSet(next.marks)
    }
    return false
  }

  markString(mark: Mark, open: boolean, parent: PMNode, index: number, html = false): string {
    const s = spec(mark)
    if (html && s.html) {
      const tag = typeof mark.attrs.mdTag === 'string' && /^[a-z]+$/.test(mark.attrs.mdTag) ? mark.attrs.mdTag : s.html
      return open ? `<${tag}>` : `</${tag}>`
    }
    const v = open ? s.open : s.close
    return typeof v === 'string' ? v : v(this, mark, parent, index)
  }

  /** Write unescaped markup. */
  raw(str: string): void {
    if (!str) return
    this.write()
    this.out += str
    this.atLineStart = false
  }

  /** Write a code span. */
  code(text: string): void {
    let t = text.replace(/\n/g, ' ')
    if (this.ctx === 'cell') t = t.replace(/\|/g, '\\|')
    const { fence, pad } = backticksFor(t)
    this.raw(pad ? `${fence} ${t} ${fence}` : `${fence}${t}${fence}`)
  }

  newline(): void {
    // Trailing spaces before a newline would make a hard break.
    this.out = this.out.replace(/[ \t]+$/, '')
    this.out += '\n'
    this.atLineStart = true
  }

  /** Write escaped text (may contain newlines from pasted content). */
  text(str: string): void {
    if (this.inAutolink) {
      this.raw(str)
      return
    }
    const parts = str.split('\n')
    parts.forEach((part, i) => {
      if (i > 0) {
        if (this.ctx === 'block') this.newline()
        else part = ' ' + part
      }
      this.write()
      if (this.atLineStart) part = part.replace(/^[ \t]+/, '')
      if (!part) return
      this.out += this.esc(part, this.atLineStart)
      this.atLineStart = false
    })
  }

  inlineNode(node: PMNode, parent: PMNode, index: number): void {
    const fn = INLINE[node.type.name]
    if (fn) fn(this, node, parent, index)
    else if (node.isText) this.text(node.text!)
    else this.text(node.textContent)
  }

  /** Escape text so markdown-it reads it back literally. */
  esc(str: string, lineStart: boolean): string {
    let out = ''
    const cell = this.ctx === 'cell'
    for (let i = 0; i < str.length; i++) {
      const ch = str[i]
      const next = str[i + 1] ?? ''
      const prev = i > 0 ? str[i - 1] : (this.out.slice(-1) || ' ')
      let escape = false
      switch (ch) {
        case '\\':
          escape = next === '' || ASCII_PUNCT.test(next)
          break
        case '*': case '`': case '[': case ']':
          escape = true
          break
        case '_':
          escape = !(/[\p{L}\p{N}]/u.test(prev) && /[\p{L}\p{N}]/u.test(next))
          break
        case '~':
          escape = next === '~' || prev === '~'
          break
        case '=':
          escape = next === '=' || prev === '='
          break
        case '<':
          escape = (lineStart && i === 0 && /^<[/A-Za-z!?]/.test(str)) || HTMLISH.test(str.slice(i))
          break
        case '&':
          escape = /^&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i.test(str.slice(i))
          break
        case '$':
          escape = !!matchInlineMathToken(str.slice(i)) || (prev === '$' && !!matchInlineMathToken(str.slice(i - 1)))
          break
        case '|':
          escape = cell
          break
      }
      out += escape ? '\\' + ch : ch
    }
    if (lineStart) {
      out = out
        .replace(/^(#{1,6})(?=[ \t]|$)/, '\\$1')
        .replace(/^([-+*>|])/, '\\$1')
        .replace(/^(\d{1,9})([.)])(?=[ \t]|$)/, '$1\\$2')
        .replace(/^(=+|-+)([ \t]*)$/, '\\$1$2')
        .replace(/^\$\$/, '\\$$$$')
        .replace(/^:/, '\\:')
    }
    if (this.opts.linkify && /[:.@]/.test(out)) out = this.escapeLinkify(out)
    return out
  }

  /** Stop markdown-it's autolinker from turning plain text into links. */
  escapeLinkify(text: string): string {
    const lk = this.opts.linkify!
    const matches = lk.match(text)
    if (!matches) return text
    let res = ''
    let last = 0
    for (const m of matches) {
      const seg = text.slice(m.index, m.lastIndex)
      const k = seg.search(m.schema === 'mailto:' || (!m.schema && seg.includes('@')) ? /@/ : m.schema ? /:/ : /\./)
      if (k < 0) continue
      res += text.slice(last, m.index + k) + '\\'
      last = m.index + k
    }
    return res + text.slice(last)
  }
}

function runEndOf(nodes: PMNode[], i: number, m: Mark): number {
  let j = i
  while (j + 1 < nodes.length && m.isInSet(nodes[j + 1].marks)) j++
  return j
}

function nextCharAfter(nodes: PMNode[], end: number): string {
  const next = nodes[end + 1]
  if (!next) return ' '
  if (/^(hardBreak|softBreak)$/.test(next.type.name)) return ' '
  if (!next.isText) return '!'
  // A mark opening on the next node writes punctuation first.
  if (next.marks.some(m => !m.isInSet(nodes[end].marks))) return '!'
  return next.text![0] ?? ' '
}

function isEmptyParagraph(n: PMNode): boolean {
  return n.type.name === 'paragraph' && n.childCount === 0
}

const TIGHT_FOLLOWERS = /^(bulletList|orderedList|taskList|codeBlock|mermaid|blockquote|heading|blockMath)$/

function listIsTight(node: PMNode): boolean {
  if (node.attrs.mdTight === false) return false
  let tight = true
  node.forEach(item => {
    let prev: PMNode | null = null
    item.forEach(child => {
      if (isEmptyParagraph(child)) return
      if (prev) {
        if (!TIGHT_FOLLOWERS.test(child.type.name)) tight = false
        // Only a list starting at 1 may interrupt a paragraph.
        if (prev.type.name === 'paragraph' && child.type.name === 'orderedList' && (child.attrs.start ?? 1) !== 1) tight = false
        // A fenced code block written as indented code could not interrupt.
        if (child.type.name === 'codeBlock' && !child.textContent && false) tight = false
      }
      prev = child
    })
  })
  return tight
}

// ---------------------------------------------------------------------------
// Marks
// ---------------------------------------------------------------------------

const MARKS: Record<string, MarkSpec> = {
  bold: { open: '**', close: '**', mixable: true, expel: true, html: 'strong' },
  italic: { open: '*', close: '*', mixable: true, expel: true, html: 'em' },
  strike: { open: '~~', close: '~~', mixable: true, expel: true, html: 's' },
  highlight: { open: '==', close: '==', mixable: true, expel: true, html: 'mark' },
  underline: { open: '<u>', close: '</u>', html: 'u' },
  subscript: { open: '<sub>', close: '</sub>' },
  superscript: { open: '<sup>', close: '</sup>' },
  kbd: { open: '<kbd>', close: '</kbd>' },
  code: { open: '`', close: '`', noEscape: true },
  link: {
    open(s, mark, parent, index) {
      const form = mark.attrs.mdForm
      const href = String(mark.attrs.href ?? '')
      const plain = (form === 'autolink' || form === 'bare') ? isPlainUrl(mark, parent, index) : null
      if (plain !== null && form === 'autolink' && (plain === href || 'mailto:' + plain === href) && !/[\s<>]/.test(href)) {
        s.inAutolink = true
        return '<'
      }
      if (plain !== null && form === 'bare' && linkifiesTo(s, plain, href)) {
        s.inAutolink = true
        return ''
      }
      // "!" right before "[" would turn the link into an image.
      if (/(^|[^\\])!$/.test(s.out)) s.out = s.out.slice(0, -1) + '\\!'
      return '['
    },
    close(s, mark) {
      if (s.inAutolink) {
        s.inAutolink = false
        return mark.attrs.mdForm === 'autolink' ? '>' : ''
      }
      return `](${linkDest(String(mark.attrs.href ?? ''))}${mark.attrs.title ? ' ' + linkTitle(String(mark.attrs.title)) : ''})`
    },
  },
}

function linkifiesTo(s: Writer, text: string, href: string): boolean {
  const lk = s.opts.linkify
  if (!lk) return false
  const m = lk.match(text)
  return !!m && m.length === 1 && m[0].index === 0 && m[0].lastIndex === text.length && m[0].url === href
}

const blankMark: MarkSpec = { open: '', close: '' }
function spec(m: Mark): MarkSpec {
  return MARKS[m.type.name] ?? blankMark
}

function linkDest(href: string): string {
  if (!href || /[\s<>]/.test(href) || !balancedParens(href)) {
    return `<${href.replace(/[<>\\]/g, '\\$&')}>`
  }
  return href.replace(/\\(?=[!-/:-@[-`{-~])/g, '\\\\')
}

function balancedParens(s: string): boolean {
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue }
    if (s[i] === '(') depth++
    else if (s[i] === ')' && --depth < 0) return false
  }
  return depth === 0
}

function linkTitle(t: string): string {
  return `"${t.replace(/["\\]/g, '\\$&')}"`
}

// ---------------------------------------------------------------------------
// Inline nodes
// ---------------------------------------------------------------------------

type InlineFn = (s: Writer, node: PMNode, parent: PMNode, index: number) => void

const INLINE: Record<string, InlineFn> = {
  text(s, node) {
    s.text(node.text!)
  },
  softBreak(s) {
    if (s.ctx === 'block') s.newline()
    else s.raw(' ')
  },
  hardBreak(s, node) {
    if (s.ctx !== 'block' || node.attrs.mdForm === 'html') {
      s.raw('<br>')
      return
    }
    s.out = s.out.replace(/[ \t]+$/, '')
    s.raw(node.attrs.mdForm === 'spaces' ? '  ' : '\\')
    s.out += '\n'
    s.atLineStart = true
  },
  image(s, node) {
    const alt = s.esc(String(node.attrs.alt ?? ''), false)
    const src = linkDest(String(node.attrs.src ?? ''))
    const title = node.attrs.title ? ' ' + linkTitle(String(node.attrs.title)) : ''
    s.raw(`![${alt}](${src}${title})`)
  },
  inlineMath(s, node) {
    const latex = String(node.attrs.latex ?? '')
    if (node.attrs.mdDelim !== '\\(' && dollarSafe(latex)) s.raw(`$${latex}$`)
    else s.raw(`\\(${latex}\\)`)
  },
  footnoteRef(s, node) {
    s.raw(`[^${node.attrs.label}]`)
  },
  htmlInline(s, node) {
    s.raw(String(node.attrs.html ?? ''))
  },
}

// ---------------------------------------------------------------------------
// Block nodes
// ---------------------------------------------------------------------------

type BlockFn = (s: Writer, node: PMNode, parent: PMNode, index: number, prev: PMNode | null) => void

function fenceFor(text: string, preferred: string | null): string {
  const ch = preferred && preferred[0] === '~' ? '~' : '`'
  const runs = text.match(ch === '`' ? /^ {0,3}`{3,}/gm : /^ {0,3}~{3,}/gm) ?? []
  const need = Math.max(3, ...runs.map(r => r.trim().length + 1))
  const len = Math.max(need, preferred && preferred[0] === ch ? preferred.length : 3)
  return ch.repeat(len)
}

const NODES: Record<string, BlockFn> = {
  paragraph(s, node, parent, index) {
    const start = s.out.length
    s.textblock(node)
    // GitHub alerts / Obsidian callouts: "> [!NOTE]" must stay unescaped.
    if (index === 0 && parent.type.name === 'blockquote') {
      const head = s.out.slice(start)
      const m = /^(\s*(?:> ?)*)\\\[!([A-Za-z]+)\\\]/.exec(head)
      if (m) s.out = s.out.slice(0, start) + head.replace(m[0], `${m[1]}[!${m[2]}]`)
    }
    s.closeBlock(node)
  },
  heading(s, node) {
    s.write('#'.repeat(node.attrs.level ?? 1) + (node.childCount ? ' ' : ''))
    const start = s.out.length
    s.textblock(node, 'heading')
    // A trailing run of # would be read as a closing sequence.
    const tail = s.out.slice(start)
    const m = /(^|\s)(#+)\s*$/.exec(tail)
    if (m) s.out = s.out.slice(0, start + m.index + m[1].length) + '\\' + tail.slice(m.index + m[1].length)
    s.closeBlock(node)
  },
  blockquote(s, node) {
    s.wrapBlock('> ', null, node, () => s.renderContent(node))
  },
  bulletList(s, node, _p, _i, prev) {
    s.renderList(node, prev, (_i, m) => `${m} `)
  },
  taskList(s, node, _p, _i, prev) {
    s.renderList(node, prev, (_i, m) => `${m} `, i => (node.child(i).attrs.checked ? '[x] ' : '[ ] '))
  },
  orderedList(s, node, _p, _i, prev) {
    const start = Number(node.attrs.start ?? 1)
    s.renderList(node, prev, (i, m) => `${start + i}${m} `)
  },
  listItem(s, node) {
    s.renderItem(node, true)
  },
  taskItem(s, node) {
    s.renderItem(node, true)
  },
  codeBlock(s, node) {
    const text = node.textContent
    const fence = fenceFor(text, node.attrs.mdFence ?? null)
    const lang = node.attrs.language ? String(node.attrs.language) : ''
    let info = lang
    const mdInfo = node.attrs.mdInfo ? String(node.attrs.mdInfo) : ''
    if (mdInfo && mdInfo.split(/\s+/)[0] === lang) info = mdInfo
    if (fence[0] === '`') info = info.replace(/`/g, '')
    s.write(fence + info)
    s.ensureNewLine()
    if (text) {
      s.lines(text)
      s.ensureNewLine()
    }
    s.write(fence)
    s.closeBlock(node)
  },
  mermaid(s, node) {
    const code = String(node.attrs.code ?? '')
    const fence = fenceFor(code, node.attrs.mdFence ?? null)
    s.write(fence + 'mermaid')
    s.ensureNewLine()
    if (code) {
      s.lines(code)
      s.ensureNewLine()
    }
    s.write(fence)
    s.closeBlock(node)
  },
  horizontalRule(s, node) {
    const m = node.attrs.mdMarkup
    s.write(typeof m === 'string' && /^([-*_])( *\1){2,}$/.test(m) ? m : '---')
    s.closeBlock(node)
  },
  blockMath(s, node) {
    const latex = String(node.attrs.latex ?? '')
    const d = String(node.attrs.mdDelim ?? '$$\n')
    const [open, close] = d.startsWith('\\[') ? ['\\[', '\\]'] : ['$$', '$$']
    if (d.endsWith('\n') || latex.includes('\n') || !latex.trim()) {
      s.write(open)
      s.ensureNewLine()
      s.lines(latex)
      s.ensureNewLine()
      s.write(close)
    } else {
      s.write(`${open}${latex}${close}`)
    }
    s.closeBlock(node)
  },
  table(s, node) {
    const rows: string[][] = []
    const aligns: Array<string | null> = []
    const old = s.ctx
    node.forEach(row => {
      const cells: string[] = []
      row.forEach((cell, _, ci) => {
        if (!aligns[ci] && cell.attrs.align) aligns[ci] = cell.attrs.align
        cells.push(cellText(s, cell))
      })
      rows.push(cells)
    })
    s.ctx = old
    const cols = Math.max(1, ...rows.map(r => r.length))
    for (const r of rows) while (r.length < cols) r.push('')
    const widths = Array.from({ length: cols }, (_, c) => Math.min(40, Math.max(3, ...rows.map(r => r[c].length))))
    const line = (cells: string[]) => '| ' + cells.map((c, i) => c.padEnd(widths[i])).join(' | ') + ' |'
    const sepCells = widths.map((w, i) => {
      const a = aligns[i]
      if (a === 'center') return ':' + '-'.repeat(Math.max(1, w - 2)) + ':'
      if (a === 'right') return '-'.repeat(Math.max(2, w - 1)) + ':'
      if (a === 'left') return ':' + '-'.repeat(Math.max(2, w - 1))
      return '-'.repeat(w)
    })
    const outLines = [line(rows[0] ?? []), '| ' + sepCells.join(' | ') + ' |', ...rows.slice(1).map(line)]
    s.write()
    s.lines(outLines.join('\n'))
    s.closeBlock(node)
  },
  frontMatter(s, node) {
    s.write()
    s.lines(String(node.attrs.raw ?? ''))
    s.closeBlock(node)
  },
  htmlBlock(s, node) {
    s.write()
    s.lines(String(node.attrs.html ?? ''))
    s.closeBlock(node)
  },
  markdownSource(s, node) {
    s.write()
    s.lines(String(node.attrs.text ?? ''))
    s.closeBlock(node)
  },
  footnoteDef(s, node) {
    s.wrapBlock('    ', `[^${node.attrs.label}]: `, node, () => s.renderContent(node))
  },
  details(s, node) {
    const openTag = String(node.attrs.openTag || '<details>')
    const summary = String(node.attrs.summary ?? '')
    s.write()
    s.lines(summary ? `${openTag}\n<summary>${summary}</summary>` : openTag)
    s.closeBlock(node)
    s.renderContent(node)
    s.flushClose(2)
    s.write()
    s.lines('</details>')
    s.closeBlock(node)
  },
}

/** A table cell as one line of inline markdown. */
function cellText(s: Writer, cell: PMNode): string {
  const parts: string[] = []
  cell.forEach(block => {
    const sub = new Writer(s.opts)
    sub.ctx = 'cell'
    if (block.isTextblock) sub.textblock(block, 'cell')
    else sub.text(block.textContent)
    const t = sub.out.replace(/\n/g, ' ').trim()
    if (t) parts.push(t)
  })
  return parts.join('<br><br>')
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

function serializeBlock(node: PMNode, prev: PMNode | null, opts: SerializeOptions, markers: WeakMap<PMNode, string>): string {
  const w = new Writer(opts)
  w.listMarker = markers
  w.render(node, node, 0, prev)
  return w.out.replace(/\s+$/, '')
}

function firstListMarker(src: string): string | null {
  const m = /^ {0,3}(?:([-*+])|\d{1,9}([.)]))(?=[ \t]|$)/.exec(src)
  return m ? (m[1] ?? m[2]) : null
}

export function serializeDoc(doc: PMNode, opts: SerializeOptions = {}): string {
  const preserve = opts.preserve !== false
  const load = opts.load ?? null
  const markers = new WeakMap<PMNode, string>()
  let out = ''
  let prev: PMNode | null = null
  let prevSrc: ReturnType<typeof blockSourceOf> | undefined
  let lastSrc: ReturnType<typeof blockSourceOf> | undefined
  let first = true

  doc.forEach(child => {
    if (isEmptyParagraph(child)) return
    let src = preserve ? blockSourceOf(child, load) : undefined
    let piece: string | null = null
    if (src) {
      piece = src.src
      const isList = /^(bulletList|orderedList|taskList)$/.test(child.type.name)
      const adjacentOriginal = prevSrc && prevSrc.load === src.load && prevSrc.index + 1 === src.index
      if (!adjacentOriginal && prev) {
        // Context changed around a verbatim block: make sure it still parses
        // the same (indented text after a list would join the list; two
        // lists with the same marker would merge).
        const prevIsList = /^(bulletList|orderedList|taskList|footnoteDef)$/.test(prev.type.name)
        if (prevIsList && /^[ \t]/.test(piece)) piece = null
        if (piece && isList && markers.get(prev) && markers.get(prev) === firstListMarker(piece)) piece = null
      }
      if (piece !== null && isList) {
        const mk = firstListMarker(piece)
        if (mk) markers.set(child, mk)
      }
      if (piece === null) src = undefined
    }
    if (piece === null) piece = serializeBlock(child, prev, opts, markers)
    if (!piece) return
    if (first) {
      if (src && src.index === 0 && src.load === load) out += src.load.head
    } else if (src && prevSrc && src.load === prevSrc.load && prevSrc.index + 1 === src.index) {
      out += src.load.seps[prevSrc.index]
    } else {
      out += prev?.type.name === 'footnoteDef' && child.type.name === 'footnoteDef' ? '\n' : '\n\n'
    }
    out += piece
    first = false
    prev = child
    prevSrc = src
    lastSrc = src
  })
  if (lastSrc && lastSrc.load === load && lastSrc.index === lastSrc.load.count - 1) out += lastSrc.load.tail
  else if (out) out += '\n'
  return out
}

/** Markdown for a slice of content (clipboard). */
export function serializeFragment(doc: PMNode, opts: SerializeOptions = {}): string {
  return serializeDoc(doc, { ...opts, load: null }).replace(/\n+$/, '')
}
