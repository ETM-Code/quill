// markdown-it tokens -> ProseMirror document for Quill's Tiptap schema.
//
// Besides building the document, the parser records where each piece came
// from so an unedited document saves byte-for-byte (see source.ts):
//   - every top-level block remembers its exact source text and the
//     separator that followed it;
//   - every paragraph / heading / table cell remembers its raw inline source,
//     so re-serialising an edited list or quote keeps untouched lines as
//     written (no new escapes, same wrapping, same emphasis characters).
import type MarkdownIt from 'markdown-it'
import type { Token } from 'markdown-it'
import type { Mark, Node as PMNode, NodeType, Schema } from '@tiptap/pm/model'
import { createMarkdownIt, splitFrontMatter } from './md'
import { inlineSources, type LoadInfo, registerLoad } from './source'

type Attrs = Record<string, unknown>

const HTML_MARKS: Record<string, string> = {
  b: 'bold', strong: 'bold',
  i: 'italic', em: 'italic',
  s: 'strike', del: 'strike', strike: 'strike',
  u: 'underline', ins: 'underline',
  mark: 'highlight',
  sub: 'subscript', sup: 'superscript',
  kbd: 'kbd',
}

const TAG_RE = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*)?\s*(\/?)>$/

function parseTag(html: string): { close: boolean; name: string; bare: boolean; selfClose: boolean } | null {
  const m = TAG_RE.exec(html.trim())
  if (!m) return null
  return { close: !!m[1], name: m[2].toLowerCase(), bare: !m[3] || !m[3].trim(), selfClose: !!m[4] }
}

const IMG_ATTRS = new Set(['src', 'alt', 'title', 'width', 'height'])

/** A lone <img> tag with only plain attributes -> image node attrs. */
function parseImgTag(html: string): Record<string, string | null> | null {
  const m = /^<img((?:\s+[a-zA-Z-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>$/i.exec(html.trim())
  if (!m) return null
  const attrs: Record<string, string | null> = {}
  const re = /([a-zA-Z-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  let a: RegExpExecArray | null
  while ((a = re.exec(m[1]))) {
    const name = a[1].toLowerCase()
    if (!IMG_ATTRS.has(name) || name in attrs) return null
    const raw = a[2] ?? a[3] ?? a[4] ?? ''
    attrs[name] = raw.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  }
  if (!attrs.src) return null
  if (attrs.width && !/^\d+(px)?$/.test(attrs.width)) return null
  if (attrs.height && !/^\d+(px)?$/.test(attrs.height)) return null
  return attrs
}

function imageAttrs(a: Record<string, string | null>) {
  const num = (v: string | null | undefined) => (v ? Number.parseInt(v, 10) : null)
  return { src: a.src ?? '', alt: a.alt || null, title: a.title || null, width: num(a.width), height: num(a.height) }
}

export interface ParseResult {
  doc: PMNode
  info: LoadInfo
}

export class MarkdownParser {
  readonly md: MarkdownIt
  constructor(readonly schema: Schema) {
    this.md = createMarkdownIt({ highlight: !!schema.marks.highlight })
  }

  private node(name: string, attrs: Attrs | null, content?: PMNode[] | PMNode | null): PMNode {
    const type: NodeType | undefined = this.schema.nodes[name]
    if (!type) throw new Error(`schema has no node ${name}`)
    return type.create(attrs, content ?? null)
  }

  private para(content: PMNode[] = []): PMNode {
    return this.node('paragraph', null, content)
  }

  /** Parse a full document (load path). */
  parse(input: string): ParseResult {
    const src = input.replace(/\r\n?/g, '\n')
    const lines = src.split('\n')
    const fm = splitFrontMatter(src)
    // Blank out the front matter so token line maps still index `lines`.
    const body = fm ? '\n'.repeat(fm.lines - 1) + src.slice(fm.raw.length) : src
    const env = {}
    const tokens = this.md.parse(body, env)

    const blocks: Array<{ node: PMNode; start: number; end: number }> = []
    if (fm) blocks.push({ node: this.node('frontMatter', { raw: fm.raw }), start: 0, end: fm.lines })
    this.convertBlocks(tokens, 0, tokens.length, 'block', blocks)

    // Anything markdown-it consumed without a token (link reference
    // definitions, abbreviations, ...) is kept verbatim as a source block.
    const withGaps: typeof blocks = []
    let cursor = 0
    const pushGap = (from: number, to: number) => {
      let a = from, b = to
      while (a < b && !lines[a].trim()) a++
      while (b > a && !lines[b - 1].trim()) b--
      if (a < b) withGaps.push({ node: this.node('markdownSource', { text: lines.slice(a, b).join('\n') }), start: a, end: b })
    }
    for (const b of blocks) {
      if (b.start > cursor) pushGap(cursor, b.start)
      withGaps.push(b)
      cursor = Math.max(cursor, b.end)
    }
    if (cursor < lines.length) pushGap(cursor, lines.length)

    // Character offsets of each block's exact text (trailing blank lines trimmed).
    const lineStart: number[] = [0]
    for (let i = 0; i < lines.length; i++) lineStart.push(lineStart[i] + lines[i].length + 1)
    const spans = withGaps.map(b => {
      let end = Math.min(b.end, lines.length)
      while (end > b.start + 1 && !lines[end - 1].trim()) end--
      const from = lineStart[b.start]
      const to = Math.min(lineStart[end] - 1, src.length)
      return { node: b.node, from, to }
    })

    const nodes = spans.map(s => s.node)
    if (!nodes.length) nodes.push(this.para())
    const doc = this.node('doc', null, nodes)
    const info = registerLoad(src, spans)
    return { doc, info }
  }

  /** Parse a markdown fragment (paste). Top-level blocks keep their source too. */
  parseFragment(input: string): ParseResult {
    return this.parse(input)
  }

  // ---------------------------------------------------------------------------
  // Blocks
  // ---------------------------------------------------------------------------

  /** Index of the token closing the one opened at `i` (same level). */
  private closeOf(tokens: Token[], i: number): number {
    const open = tokens[i]
    if (open.nesting !== 1) return i
    let depth = 0
    for (let j = i; j < tokens.length; j++) {
      depth += tokens[j].nesting
      if (depth === 0) return j
    }
    return tokens.length - 1
  }

  private rangeOf(tokens: Token[], i: number, j: number): [number, number] | null {
    let start = Infinity, end = -Infinity
    for (let k = i; k <= j; k++) {
      const m = tokens[k].map
      if (m) { start = Math.min(start, m[0]); end = Math.max(end, m[1]) }
    }
    return start === Infinity ? null : [start, end]
  }

  private convertBlocks(
    tokens: Token[], from: number, to: number, ctx: 'block' | 'cell',
    top?: Array<{ node: PMNode; start: number; end: number }>,
  ): PMNode[] {
    const out: PMNode[] = []
    let i = from
    while (i < to) {
      const t = tokens[i]
      const close = this.closeOf(tokens, i)
      let node: PMNode | PMNode[] | null = null
      let last = close

      // <details> ... </details> spread over several html blocks
      if (t.type === 'html_block' && /^\s*<details[\s>]/i.test(t.content) && !/<\/details>/i.test(t.content)) {
        const d = this.tryDetails(tokens, i, to)
        if (d) { node = d.node; last = d.last }
      }

      if (!node) node = this.convertBlock(tokens, i, close, ctx)
      if (node) {
        const list = Array.isArray(node) ? node : [node]
        out.push(...list)
        if (top && list.length) {
          const r = this.rangeOf(tokens, i, last)
          if (r) for (const n of list) top.push({ node: n, start: r[0], end: r[1] })
        }
      }
      i = last + 1
    }
    return out
  }

  private tryDetails(tokens: Token[], i: number, to: number): { node: PMNode; last: number } | null {
    const open = tokens[i]
    const m = /^\s*(<details[^>]*>)\s*(?:<summary>([\s\S]*?)<\/summary>)?\s*$/i.exec(open.content)
    if (!m) return null
    const level = open.level
    let depth = 1
    for (let j = i + 1; j < to; j++) {
      const t = tokens[j]
      if (t.type !== 'html_block' || t.level !== level) continue
      if (/^\s*<details[\s>]/i.test(t.content) && !/<\/details>/i.test(t.content)) depth++
      else if (/^\s*<\/details>\s*$/i.test(t.content)) {
        depth--
        if (depth === 0) {
          const body = this.convertBlocks(tokens, i + 1, j, 'block')
          const node = this.node('details', { openTag: m[1], summary: m[2] ?? '' }, body.length ? body : [this.para()])
          return { node, last: j }
        }
      }
    }
    return null
  }

  private convertBlock(tokens: Token[], i: number, close: number, ctx: 'block' | 'cell'): PMNode | PMNode[] | null {
    const t = tokens[i]
    switch (t.type) {
      case 'paragraph_open': {
        const inline = tokens[i + 1]
        const node = this.para(this.convertInline(inline))
        inlineSources.set(node, { src: inline.content, ctx })
        return node
      }
      case 'heading_open': {
        const inline = tokens[i + 1]
        const node = this.node('heading', { level: Number(t.tag.slice(1)) }, this.convertInline(inline))
        if (!inline.content.includes('\n')) inlineSources.set(node, { src: inline.content, ctx })
        return node
      }
      case 'blockquote_open': {
        const body = this.convertBlocks(tokens, i + 1, close, ctx)
        return this.node('blockquote', null, body.length ? body : [this.para()])
      }
      case 'bullet_list_open':
      case 'ordered_list_open':
        return this.convertList(tokens, i, close, ctx)
      case 'fence': {
        const info = t.info.trim()
        const lang = info.split(/\s+/)[0] ?? ''
        const text = t.content.replace(/\n$/, '')
        if (lang.toLowerCase() === 'mermaid' && this.schema.nodes.mermaid) {
          return this.node('mermaid', { code: text, mdFence: t.markup })
        }
        return this.node(
          'codeBlock',
          { language: lang || null, mdFence: t.markup, mdInfo: info || null },
          text ? this.schema.text(text) : null,
        )
      }
      case 'code_block': {
        const text = t.content.replace(/\n$/, '')
        return this.node('codeBlock', { language: null, mdFence: null, mdInfo: null }, text ? this.schema.text(text) : null)
      }
      case 'hr':
        return this.node('horizontalRule', { mdMarkup: t.markup || null })
      case 'html_block': {
        const html = t.content.replace(/\n+$/, '')
        const img = this.schema.nodes.image ? parseImgTag(html) : null
        if (img && (img.width || img.height)) return this.para([this.schema.nodes.image.create(imageAttrs(img))])
        return this.node('htmlBlock', { html })
      }
      case 'math_block':
        return this.node('blockMath', { latex: t.content, mdDelim: t.markup })
      case 'table_open':
        return this.convertTable(tokens, i, close)
      case 'footnote_reference_open': {
        const body = this.convertBlocks(tokens, i + 1, close, 'block')
        return this.node('footnoteDef', { label: t.meta?.label ?? '' }, body.length ? body : [this.para()])
      }
      default:
        // Unknown container: keep its children.
        if (t.nesting === 1 && close > i) return this.convertBlocks(tokens, i + 1, close, ctx)
        return null
    }
  }

  private convertList(tokens: Token[], i: number, close: number, ctx: 'block' | 'cell'): PMNode {
    const t = tokens[i]
    const ordered = t.type === 'ordered_list_open'
    const task = !ordered && !!t.meta?.task && !!this.schema.nodes.taskList
    const items: PMNode[] = []
    let tight = true
    let j = i + 1
    while (j < close) {
      const item = tokens[j]
      const itemClose = this.closeOf(tokens, j)
      if (item.type === 'list_item_open') {
        for (let k = j + 1; k < itemClose; k++) {
          if (tokens[k].type === 'paragraph_open' && tokens[k].level === item.level + 1 && !tokens[k].hidden) tight = false
        }
        let body = this.convertBlocks(tokens, j + 1, itemClose, ctx)
        if (!body.length || body[0].type.name !== 'paragraph') body = [this.para(), ...body]
        items.push(task
          ? this.node('taskItem', { checked: !!item.meta?.checked }, body)
          : this.node('listItem', null, body))
      }
      j = itemClose + 1
    }
    if (task) return this.node('taskList', { mdBullet: t.markup, mdTight: tight }, items)
    if (ordered) {
      const start = Number(t.attrGet('start') ?? 1)
      return this.node('orderedList', { start, mdDelim: t.markup, mdTight: tight }, items)
    }
    return this.node('bulletList', { mdBullet: t.markup, mdTight: tight }, items)
  }

  private convertTable(tokens: Token[], i: number, close: number): PMNode {
    const rows: PMNode[] = []
    let row: PMNode[] | null = null
    for (let j = i + 1; j < close; j++) {
      const t = tokens[j]
      if (t.type === 'tr_open') row = []
      else if (t.type === 'tr_close') {
        if (row) rows.push(this.node('tableRow', null, row))
        row = null
      } else if ((t.type === 'th_open' || t.type === 'td_open') && row) {
        const style = t.attrGet('style') ?? ''
        const am = /text-align:\s*(left|right|center)/.exec(style)
        const inline = tokens[j + 1]
        const content = inline?.type === 'inline' ? this.convertInline(inline) : []
        const p = this.para(content)
        // markdown-it unescapes `\|` in cell content (code spans included), so
        // every pipe left in it needs its escape back before being reused.
        if (inline?.type === 'inline') inlineSources.set(p, { src: inline.content.replace(/\|/g, '\\|'), ctx: 'cell' })
        row.push(this.node(t.type === 'th_open' ? 'tableHeader' : 'tableCell', { align: am ? am[1] : null }, [p]))
      }
    }
    return this.node('table', null, rows)
  }

  // ---------------------------------------------------------------------------
  // Inline
  // ---------------------------------------------------------------------------

  convertInline(inline: Token): PMNode[] {
    const children = inline.children ?? []
    const out: PMNode[] = []
    let marks: readonly Mark[] = []
    const schema = this.schema
    const markType = (name: string) => schema.marks[name]

    const addMark = (name: string, attrs?: Attrs) => {
      const type = markType(name)
      if (type) marks = type.create(attrs ?? null).addToSet(marks)
    }
    const removeMark = (name: string) => {
      const type = markType(name)
      if (type) marks = type.removeFromSet(marks)
    }
    const text = (s: string, extra?: Mark) => {
      if (!s) return
      const set = extra ? extra.addToSet(marks) : marks
      const last = out[out.length - 1]
      if (last && last.isText && last.sameMarkup(schema.text('x', set))) {
        out[out.length - 1] = schema.text(last.text + s, set)
      } else {
        out.push(schema.text(s, set))
      }
    }
    const leaf = (name: string, attrs: Attrs | null) => {
      const type = schema.nodes[name]
      if (!type) return false
      out.push(type.create(attrs, null, marks))
      return true
    }

    // Pair up inline HTML tags that map to marks (<u>..</u>, <kbd>..</kbd>).
    const paired = new Set<number>()
    const openStack: Array<{ name: string; idx: number }> = []
    children.forEach((c, idx) => {
      if (c.type !== 'html_inline') return
      const tag = parseTag(c.content)
      if (!tag || !HTML_MARKS[tag.name] || !markType(HTML_MARKS[tag.name])) return
      if (!tag.close && tag.bare && !tag.selfClose) openStack.push({ name: tag.name, idx })
      else if (tag.close) {
        for (let k = openStack.length - 1; k >= 0; k--) {
          if (openStack[k].name === tag.name) {
            paired.add(openStack[k].idx)
            paired.add(idx)
            openStack.splice(k, 1)
            break
          }
        }
      }
    })

    for (let idx = 0; idx < children.length; idx++) {
      const c = children[idx]
      switch (c.type) {
        case 'text':
          text(c.content)
          break
        case 'softbreak':
          if (!leaf('softBreak', null)) text(' ')
          break
        case 'hardbreak':
          leaf('hardBreak', { mdForm: null })
          break
        case 'code_inline':
          text(c.content, markType('code')?.create())
          break
        case 'strong_open': addMark('bold'); break
        case 'strong_close': removeMark('bold'); break
        case 'em_open': addMark('italic'); break
        case 'em_close': removeMark('italic'); break
        case 's_open': addMark('strike'); break
        case 's_close': removeMark('strike'); break
        case 'mark_open': addMark('highlight'); break
        case 'mark_close': removeMark('highlight'); break
        case 'link_open': {
          const form = c.markup === 'autolink' ? 'autolink' : c.markup === 'linkify' ? 'bare' : null
          addMark('link', { href: c.attrGet('href') ?? '', title: c.attrGet('title') ?? null, mdForm: form })
          break
        }
        case 'link_close': removeMark('link'); break
        case 'image': {
          const alt = this.md.renderer.renderInlineAsText(c.children ?? [], this.md.options, {})
          leaf('image', { src: c.attrGet('src') ?? '', alt: alt || null, title: c.attrGet('title') || null })
          break
        }
        case 'footnote_ref':
          if (!leaf('footnoteRef', { label: c.meta?.label ?? String((c.meta?.id ?? 0) + 1) })) text(`[^${c.meta?.label}]`)
          break
        case 'math_inline':
          leaf('inlineMath', { latex: c.content, mdDelim: c.markup })
          break
        case 'html_inline': {
          const tag = parseTag(c.content)
          if (tag && paired.has(idx)) {
            if (tag.close) removeMark(HTML_MARKS[tag.name])
            else addMark(HTML_MARKS[tag.name], { mdTag: tag.name })
          } else if (tag && tag.name === 'br') {
            leaf('hardBreak', { mdForm: 'html' })
          } else if (tag && tag.name === 'img' && parseImgTag(c.content)?.width) {
            leaf('image', imageAttrs(parseImgTag(c.content)!))
          } else {
            leaf('htmlInline', { html: c.content })
          }
          break
        }
        default:
          if (c.content) text(c.content)
      }
    }
    // Hard/soft breaks at the very end of a block have no meaning.
    while (out.length && /^(hardBreak|softBreak)$/.test(out[out.length - 1].type.name)) out.pop()
    return out
  }
}
