// Schema additions that let every markdown construct survive a round trip:
// front matter, raw HTML (block + inline), unparsed source, soft line breaks,
// footnotes, <details>, highlight / sub / sup / kbd marks, plus hidden
// attributes that remember how a construct was written (bullet character,
// fence, tight/loose, link form...). Also: GitHub alert callouts and Enter in
// table cells.
import { Extension, Mark, Node, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { htmlToText, sanitizeHtml, sanitizeHtmlSync } from './sanitize'
import './markdown.css'

const hidden = (def: unknown = null) => ({ default: def, rendered: false })

export const MarkdownAttrs = Extension.create({
  name: 'markdownAttrs',
  addGlobalAttributes() {
    return [
      { types: ['bulletList', 'taskList'], attributes: { mdBullet: hidden(), mdTight: hidden() } },
      { types: ['orderedList'], attributes: { mdDelim: hidden(), mdTight: hidden() } },
      { types: ['codeBlock'], attributes: { mdFence: hidden(), mdInfo: hidden() } },
      { types: ['mermaid'], attributes: { mdFence: hidden() } },
      { types: ['horizontalRule'], attributes: { mdMarkup: hidden() } },
      { types: ['hardBreak'], attributes: { mdForm: hidden() } },
      // Marks that came from HTML tags (<b>, <s>, <mark>...) save as that tag.
      { types: ['bold', 'italic', 'strike', 'highlight', 'underline'], attributes: { mdTag: hidden() } },
      { types: ['inlineMath', 'blockMath'], attributes: { mdDelim: hidden() } },
      {
        types: ['link'],
        attributes: {
          title: {
            default: null,
            parseHTML: (el: HTMLElement) => el.getAttribute('title'),
            renderHTML: (a: Record<string, unknown>) => (a.title ? { title: a.title } : {}),
          },
          mdForm: hidden(),
        },
      },
    ]
  },
})

/** YAML / TOML front matter, kept verbatim, shown as a collapsed block. */
export const FrontMatter = Node.create({
  name: 'frontMatter',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return { raw: { default: '', parseHTML: el => el.getAttribute('data-raw') ?? '', renderHTML: a => ({ 'data-raw': a.raw }) } }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="front-matter"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'front-matter' })]
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('details')
      dom.className = 'md-front-matter'
      dom.contentEditable = 'false'
      const summary = document.createElement('summary')
      const pre = document.createElement('pre')
      const fill = (n: PMNode) => {
        const raw = String(n.attrs.raw ?? '')
        const body = raw.split('\n').slice(1, -1)
        const keys = body.map(l => /^([\w"'.-][^:=]*?)\s*[:=]/.exec(l)?.[1]).filter(Boolean)
        summary.textContent = keys.length ? `Properties · ${keys.slice(0, 6).join(', ')}${keys.length > 6 ? '…' : ''}` : 'Properties'
        pre.textContent = body.join('\n')
      }
      fill(node)
      dom.append(summary, pre)
      return {
        dom,
        update: n => {
          if (n.type.name !== 'frontMatter') return false
          fill(n)
          return true
        },
        ignoreMutation: () => true,
        stopEvent: e => e.type === 'click' || e.type === 'mousedown',
      }
    }
  },
})

function htmlBlockView(attr: string, inline: boolean) {
  return ({ node }: { node: PMNode }) => {
    const dom = document.createElement(inline ? 'span' : 'div')
    dom.contentEditable = 'false'
    let current = ''
    const show = (html: string, clean: string) => {
      if (html !== current) return
      if (inline || clean.replace(/<[^>]*>/g, '').trim() || /<(img|svg|table|hr|video)\b/i.test(clean)) {
        dom.innerHTML = clean
      } else {
        dom.classList.add('md-html-source')
        dom.textContent = html
      }
    }
    const fill = (n: PMNode) => {
      const html = String(n.attrs[attr] ?? '')
      current = html
      dom.className = inline ? 'md-html-inline' : 'md-html-block'
      dom.title = html.length > 300 ? html.slice(0, 300) + '…' : html
      const trimmed = html.trim()
      // Comments and (inline) tags other than images show their source, so
      // placeholders like <API_KEY> or <Enter> stay readable.
      if (/^<!--[\s\S]*-->$/.test(trimmed) || (inline && !/^<img\s/i.test(trimmed))) {
        dom.classList.add(/^<!--/.test(trimmed) ? 'md-html-comment' : 'md-html-tag')
        dom.textContent = html
        return
      }
      const clean = sanitizeHtmlSync(html)
      if (clean !== null) show(html, clean)
      else {
        dom.textContent = inline ? '' : html
        void sanitizeHtml(html).then(c => show(html, c))
      }
    }
    fill(node)
    return {
      dom,
      update: (n: PMNode) => {
        if (n.type !== node.type) return false
        fill(n)
        return true
      },
      ignoreMutation: () => true,
    }
  }
}

/** A block of raw HTML: original kept, sanitised copy displayed. */
export const HtmlBlock = Node.create({
  name: 'htmlBlock',
  group: 'block',
  atom: true,
  addAttributes() {
    return { html: { default: '', parseHTML: el => el.getAttribute('data-html') ?? '', renderHTML: a => ({ 'data-html': a.html }) } }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="html-block"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'html-block' })]
  },
  addNodeView() {
    return htmlBlockView('html', false)
  },
})

/** An inline HTML tag (or comment) kept verbatim. */
export const HtmlInline = Node.create({
  name: 'htmlInline',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return { html: { default: '', parseHTML: el => el.getAttribute('data-html') ?? '', renderHTML: a => ({ 'data-html': a.html }) } }
  },
  parseHTML() {
    return [{ tag: 'span[data-type="html-inline"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'html-inline' })]
  },
  renderText({ node }) {
    return String(node.attrs.html ?? '')
  },
  addNodeView() {
    return htmlBlockView('html', true)
  },
})

/** Markdown the editor has no node for (link definitions etc.), kept verbatim. */
export const MarkdownSource = Node.create({
  name: 'markdownSource',
  group: 'block',
  atom: true,
  addAttributes() {
    return { text: { default: '', parseHTML: el => el.textContent ?? '', renderHTML: () => ({}) } }
  },
  parseHTML() {
    return [{ tag: 'pre[data-type="markdown-source"]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['pre', mergeAttributes(HTMLAttributes, { 'data-type': 'markdown-source', class: 'md-source' }), String(node.attrs.text ?? '')]
  },
})

/**
 * A soft line break from the source (a newline inside a paragraph). Displays
 * as a space, saves as a newline, so hard-wrapped files keep their wrapping.
 */
export const SoftBreak = Node.create({
  name: 'softBreak',
  group: 'inline',
  inline: true,
  selectable: false,
  atom: true,
  parseHTML() {
    return [{ tag: 'span.md-sb' }]
  },
  renderHTML() {
    return ['span', { class: 'md-sb' }, ' ']
  },
  renderText() {
    return ' '
  },
  extendNodeSchema() {
    return { leafText: () => ' ' }
  },
})

export const FootnoteRef = Node.create({
  name: 'footnoteRef',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return { label: { default: '1', parseHTML: el => el.getAttribute('data-label') ?? '1', renderHTML: a => ({ 'data-label': a.label }) } }
  },
  parseHTML() {
    return [{ tag: 'sup[data-type="footnote-ref"]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['sup', mergeAttributes(HTMLAttributes, { 'data-type': 'footnote-ref', class: 'md-fnref' }), String(node.attrs.label)]
  },
  renderText({ node }) {
    return `[^${node.attrs.label}]`
  },
})

export const FootnoteDef = Node.create({
  name: 'footnoteDef',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return { label: { default: '1', parseHTML: el => el.getAttribute('data-label') ?? '1', renderHTML: a => ({ 'data-label': a.label }) } }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="footnote-def"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'footnote-def', class: 'md-fndef' }), 0]
  },
})

/** <details><summary>…</summary> … </details> with editable markdown inside. */
export const Details = Node.create({
  name: 'details',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      openTag: { default: '<details>', parseHTML: el => el.getAttribute('data-open-tag') ?? '<details>', renderHTML: a => ({ 'data-open-tag': a.openTag }) },
      summary: { default: '', parseHTML: el => el.getAttribute('data-summary') ?? '', renderHTML: a => ({ 'data-summary': a.summary }) },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="details"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'details' }), 0]
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div')
      dom.className = 'md-details'
      const head = document.createElement('div')
      head.className = 'md-details-summary'
      head.contentEditable = 'false'
      const body = document.createElement('div')
      body.className = 'md-details-body'
      const fill = (n: PMNode) => {
        head.textContent = htmlToText(String(n.attrs.summary || 'Details')) || 'Details'
        if (/\sopen\b/i.test(String(n.attrs.openTag))) dom.classList.add('open')
      }
      fill(node)
      head.addEventListener('mousedown', e => {
        e.preventDefault()
        dom.classList.toggle('open')
      })
      dom.append(head, body)
      return {
        dom,
        contentDOM: body,
        update: n => {
          if (n.type.name !== 'details') return false
          fill(n)
          return true
        },
        ignoreMutation: m => !body.contains(m.target),
      }
    }
  },
})

function simpleMark(name: string, tag: string, extraParse: Array<{ style: string }> = []) {
  return Mark.create({
    name,
    parseHTML() {
      return [{ tag }, ...extraParse]
    },
    renderHTML({ HTMLAttributes }) {
      return [tag, HTMLAttributes, 0]
    },
  })
}

// ==highlight== is the UX layer's `highlight` mark (src/extensions/highlight.ts);
// the codec handles it by name.
export const Subscript = simpleMark('subscript', 'sub', [{ style: 'vertical-align=sub' }])
export const Superscript = simpleMark('superscript', 'sup', [{ style: 'vertical-align=super' }])
export const Kbd = simpleMark('kbd', 'kbd')

// ---------------------------------------------------------------------------
// GitHub alerts / Obsidian callouts: "> [!NOTE]" blockquotes are styled as
// callouts by decoration only; the document (and the file) keep the marker.
// ---------------------------------------------------------------------------

const CALLOUT_RE = /^\[!([A-Za-z]+)\]([+-]?)/
const calloutKey = new PluginKey('quillCallouts')

/** Marker positions [from, to) of every callout, for the editing check. */
function calloutMarkers(doc: PMNode): Array<{ pos: number; node: PMNode; kind: string; from: number; to: number }> {
  const found: Array<{ pos: number; node: PMNode; kind: string; from: number; to: number }> = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'blockquote') {
      const first = node.firstChild
      const text = first?.firstChild
      if (first?.type.name === 'paragraph' && text?.isText) {
        const m = CALLOUT_RE.exec(text.text!)
        if (m) found.push({ pos, node, kind: m[1].toLowerCase(), from: pos + 2, to: pos + 2 + m[0].length })
      }
      return true
    }
    // Only containers can hold blockquotes.
    return !node.isTextblock && !node.isAtom
  })
  return found
}

// The "[!NOTE]" marker shows as a "Note" label; the raw marker comes back
// while the caret is on that line so it can still be edited.
function calloutDecorations(state: EditorState): DecorationSet {
  const decos: Decoration[] = []
  const { from, to } = state.selection
  for (const c of calloutMarkers(state.doc)) {
    const firstLineEnd = c.pos + 1 + c.node.firstChild!.nodeSize
    const editing = to >= c.from && from <= firstLineEnd
    const label = c.kind.charAt(0).toUpperCase() + c.kind.slice(1)
    decos.push(Decoration.node(c.pos, c.pos + c.node.nodeSize, { class: `md-callout md-callout-${c.kind}`, 'data-callout': c.kind }))
    decos.push(Decoration.inline(c.from, c.to, { class: editing ? 'md-callout-marker md-callout-editing' : 'md-callout-marker', 'data-label': label }))
  }
  return DecorationSet.create(state.doc, decos)
}

export const Callouts = Extension.create({
  name: 'callouts',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: calloutKey,
        state: {
          init: (_, state) => calloutDecorations(state),
          apply: (tr, old, _oldState, newState) => (tr.docChanged || tr.selectionSet ? calloutDecorations(newState) : old),
        },
        props: {
          decorations(state) {
            return calloutKey.getState(state)
          },
        },
      }),
    ]
  },
})

/** Enter inside a table cell inserts a line break (GFM cells are one line). */
export const TableCellEnter = Extension.create({
  name: 'tableCellEnter',
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { $from } = editor.state.selection
        for (let d = $from.depth; d > 0; d--) {
          const n = $from.node(d).type.name
          if (n === 'tableCell' || n === 'tableHeader') return editor.commands.setHardBreak()
          if (n === 'codeBlock') return false
        }
        return false
      },
    }
  },
})

export const markdownExtensions = [
  MarkdownAttrs,
  FrontMatter,
  HtmlBlock,
  HtmlInline,
  MarkdownSource,
  SoftBreak,
  FootnoteRef,
  FootnoteDef,
  Details,
  Subscript,
  Superscript,
  Kbd,
  Callouts,
  TableCellEnter,
]
