// Clipboard in and out.
//
// Copy: text/plain carries markdown (raw code when the selection is all code),
// text/html carries rich HTML other apps understand (math as LaTeX source,
// mermaid as an SVG image, local images with absolute file URLs) while still
// round-tripping into Quill through data-* attributes.
//
// Paste: markdown text is parsed (also when an editor such as VS Code or a
// terminal adds styled HTML), TSV/CSV becomes a table, pasted tables get a
// header row, and chat-app code blocks lose their language label.
import { DOMSerializer, Fragment, Slice, type Node as PMNode, type Schema } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { getCodec } from './index'
import { renderedMermaidSvg } from '../mermaid'
import { htmlToText, sanitizeHtmlSync } from './sanitize'

// ---------------------------------------------------------------------------
// Copy helpers
// ---------------------------------------------------------------------------

/**
 * Copy text from a click handler. WKWebView often rejects
 * navigator.clipboard (no permission, or the user activation is gone by the
 * time the promise runs), so try the synchronous execCommand path first while
 * the click's activation is live, then fall back to the async API.
 */
export async function copyText(text: string): Promise<boolean> {
  if (copyTextSync(text)) return true
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through
  }
  return false
}

/** Hidden-textarea + execCommand('copy'); must run inside a user gesture. */
export function copyTextSync(text: string): boolean {
  const active = document.activeElement as HTMLElement | null
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;'
  document.body.appendChild(ta)
  let ok = false
  // Make sure the copy event carries exactly our text, even if something
  // else (the editor) would handle it.
  const onCopy = (e: ClipboardEvent) => {
    e.stopImmediatePropagation()
    if (e.clipboardData) {
      e.preventDefault()
      e.clipboardData.setData('text/plain', text)
      ok = true
    }
  }
  ta.addEventListener('copy', onCopy, true)
  try {
    ta.focus({ preventScroll: true })
    ta.select()
    ta.setSelectionRange(0, text.length)
    ok = document.execCommand('copy') || ok
  } catch {
    ok = false
  } finally {
    ta.removeEventListener('copy', onCopy, true)
    ta.remove()
    active?.focus?.({ preventScroll: true })
  }
  return ok
}

/** Raw code when the slice is one code block (or a run of inline code). */
export function codeOnlyText(slice: Slice): string | null {
  const content = slice.content
  if (content.childCount === 1) {
    const only = content.firstChild!
    if (only.type.name === 'codeBlock') return only.textContent
    if (only.type.name === 'mermaid') return String(only.attrs.code ?? '')
  }
  // All text inside the slice carries the code mark.
  let sawText = false
  let allCode = true
  content.descendants(node => {
    if (!allCode) return false
    if (node.isText) {
      sawText = true
      if (!node.marks.some(m => m.type.name === 'code')) allCode = false
    } else if (node.isInline) {
      allCode = false
    } else if (node.isBlock && node.type.name !== 'paragraph') {
      // One paragraph wrapper is fine (open slice); other blocks are mixed.
      if (!(content.childCount === 1 && node === content.firstChild)) allCode = false
    }
    return true
  })
  if (sawText && allCode && content.childCount === 1) return content.textBetween(0, content.size)
  return null
}

export function clipboardText(schema: Schema, slice: Slice): string {
  const code = codeOnlyText(slice)
  if (code !== null) return code
  const doc = schema.topNodeType.createAndFill(null, slice.content) ?? schema.node('doc', null, slice.content)
  return getCodec(schema).serializeFragment(doc)
}

// ---------------------------------------------------------------------------
// Rich HTML out
// ---------------------------------------------------------------------------

let documentDir: string | null = null

/** Directory of the open file, for absolutising relative image paths on copy. */
export function setDocumentDir(dir: string | null): void {
  documentDir = dir
}

function absoluteFileUrl(src: string): string {
  if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src)) return src
  let path = src
  if (!src.startsWith('/')) {
    if (!documentDir) return src
    path = `${documentDir.replace(/\/+$/, '')}/${src.replace(/^\.\//, '')}`
  }
  return 'file://' + encodeURI(path)
}

function svgDataUrl(svg: string): string {
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)))
}

let cachedSerializer: { schema: Schema; ser: DOMSerializer } | null = null

export function richClipboardSerializer(schema: Schema): DOMSerializer {
  if (cachedSerializer?.schema === schema) return cachedSerializer.ser
  const base = DOMSerializer.fromSchema(schema)
  const nodes = { ...base.nodes }
  const marks = { ...base.marks }
  nodes.inlineMath = node => {
    const span = document.createElement('span')
    span.setAttribute('data-type', 'inline-math')
    span.setAttribute('data-latex', node.attrs.latex)
    span.textContent = `$${node.attrs.latex}$`
    return span
  }
  nodes.blockMath = node => {
    const div = document.createElement('div')
    div.setAttribute('data-type', 'block-math')
    div.setAttribute('data-latex', node.attrs.latex)
    div.textContent = `$$${node.attrs.latex}$$`
    return div
  }
  nodes.mermaid = node => {
    const code = String(node.attrs.code ?? '')
    const div = document.createElement('div')
    div.setAttribute('data-type', 'mermaid')
    div.setAttribute('data-code', code)
    const svg = renderedMermaidSvg(code)
    if (svg) {
      const img = document.createElement('img')
      img.alt = 'Mermaid diagram'
      img.src = svgDataUrl(svg)
      div.appendChild(img)
    } else {
      const pre = document.createElement('pre')
      const c = document.createElement('code')
      c.className = 'language-mermaid'
      c.textContent = code
      pre.appendChild(c)
      div.appendChild(pre)
    }
    return div
  }
  nodes.image = node => {
    const img = document.createElement('img')
    const src = String(node.attrs.src ?? '')
    img.src = absoluteFileUrl(src)
    img.setAttribute('data-quill-src', src)
    if (node.attrs.alt) img.alt = node.attrs.alt
    if (node.attrs.title) img.title = node.attrs.title
    return img
  }
  nodes.softBreak = () => document.createTextNode(' ')
  nodes.htmlBlock = node => {
    const div = document.createElement('div')
    div.setAttribute('data-type', 'html-block')
    div.setAttribute('data-html', node.attrs.html)
    const html = String(node.attrs.html ?? '')
    const clean = sanitizeHtmlSync(html)
    if (clean !== null) div.innerHTML = clean
    else div.textContent = htmlToText(html)
    return div
  }
  nodes.htmlInline = node => {
    const span = document.createElement('span')
    span.setAttribute('data-type', 'html-inline')
    span.setAttribute('data-html', node.attrs.html)
    const html = String(node.attrs.html ?? '')
    const clean = /^<img\s/i.test(html.trim()) ? sanitizeHtmlSync(html) : null
    if (clean !== null) span.innerHTML = clean
    else span.textContent = html
    return span
  }
  nodes.codeBlock = node => {
    const pre = document.createElement('pre')
    const code = document.createElement('code')
    if (node.attrs.language) code.className = `language-${node.attrs.language}`
    pre.appendChild(code)
    return { dom: pre, contentDOM: code }
  }
  const ser = new DOMSerializer(nodes, marks)
  cachedSerializer = { schema, ser }
  return ser
}

// ---------------------------------------------------------------------------
// Paste in
// ---------------------------------------------------------------------------

const MARKDOWN_HINTS = [
  /^#{1,6}\s\S/m, // heading
  /^ {0,3}(```|~~~)/m, // fence
  /\[[^\]\n]+\]\([^)\s]+\)/, // link
  /!\[[^\]\n]*\]\([^)\s]+\)/, // image
  /\*\*[^*\n]+\*\*/, // bold
  /__[^_\n]+__/, // bold
  /(^|[\s(])\*[^*\s][^*\n]*\*(?=[\s).,;:!?]|$)/m, // *em*
  /(^|[\s(])_[^_\s][^_\n]*_(?=[\s).,;:!?]|$)/m, // _em_
  /~~[^~\n]+~~/, // strike
  /==[^=\n]+==/, // highlight
  /`[^`\n]+`/, // inline code
  /(^|[^\w$])\$[^\s$][^$\n]*\$(?![\d$])/, // inline math
  /^\$\$/m, // block math
  /\[\^[^\]\s]+\]/, // footnote
  /^>\s?\S/m, // blockquote
  /^\|.+\|\s*$/m, // table row
  /^ {0,3}([-*+]|\d{1,9}[.)])\s+\S/m, // list item
  /^- \[[ xX]\]\s/m, // task item
  /^ {0,3}(---|\*\*\*|___)\s*$/m, // hr
  /<\/?(kbd|sub|sup|u|mark|details|summary|br)\b[^>]*>/i, // inline html
]

export function looksLikeMarkdown(text: string): boolean {
  if (text.length < 3) return false
  return MARKDOWN_HINTS.some(re => re.test(text))
}

/** HTML that is only styled text (VS Code, terminals): the plain text is the source. */
export function isCodeEditorHtml(html: string, types: readonly string[] = []): boolean {
  if (types.includes('vscode-editor-data')) return true
  if (!html) return false
  const body = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<\/?(html|head|body|meta|style)[^>]*>/gi, '')
  // Semantic markup means a real rich-text source.
  if (/<(p|h[1-6]|ul|ol|li|table|a|img|strong|em|b|i|blockquote|code)\b/i.test(body)) return false
  return /white-space:\s*pre|font-family:[^;"]*(menlo|monaco|consolas|courier|monospace|sf mono|jetbrains)/i.test(body) || /^\s*<pre\b/i.test(body)
}

function splitCsvLine(line: string, sep: string): string[] {
  if (sep === '\t') return line.split('\t')
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') q = false
      else cur += ch
    } else if (ch === '"' && cur.trim() === '') { q = true; cur = '' }
    else if (ch === sep) { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out.map(c => c.trim())
}

/** Rows of a TSV / CSV paste, or null when the text isn't tabular. */
export function parseDelimited(text: string): string[][] | null {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n')
  if (lines.length < 2) return null
  if (lines.every(l => l.includes('\t'))) {
    const rows = lines.map(l => splitCsvLine(l, '\t'))
    const n = rows[0].length
    if (n >= 2 && rows.every(r => r.length === n)) return rows
    return null
  }
  if (lines.every(l => l.includes(','))) {
    const rows = lines.map(l => splitCsvLine(l, ','))
    const n = rows[0].length
    if (n < 2 || !rows.every(r => r.length === n)) return null
    if (rows.some(r => r.some(c => c.length > 60))) return null
    // Prose with commas rarely has the same comma count on every line and
    // short "cells"; also require no sentence-like cells in the header.
    if (rows[0].some(c => /[.!?]$/.test(c) || c.split(' ').length > 5)) return null
    return rows
  }
  return null
}

export function tableFromRows(schema: Schema, rows: string[][]): PMNode {
  const cell = (type: string, text: string) =>
    schema.nodes[type].create(null, schema.nodes.paragraph.create(null, text ? schema.text(text) : null))
  return schema.nodes.table.create(null, rows.map((r, i) =>
    schema.nodes.tableRow.create(null, r.map(c => cell(i === 0 ? 'tableHeader' : 'tableCell', c))),
  ))
}

function insertDoc(view: EditorView, content: Fragment): void {
  const slice = Slice.maxOpen(content)
  view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'))
}

function inCode(view: EditorView): boolean {
  const { $from } = view.state.selection
  return $from.parent.type.spec.code === true || $from.parent.type.name === 'codeBlock'
}

/** ProseMirror handlePaste: returns true when it handled the paste. */
export function handleMarkdownPaste(view: EditorView, event: ClipboardEvent): boolean {
  const cb = event.clipboardData
  if (!cb) return false
  if (inCode(view)) return false
  const html = cb.getData('text/html')
  const text = cb.getData('text/plain')
  if (!text) return false
  const types = Array.from(cb.types ?? [])
  // Our own copies round-trip through the HTML (keeps every attribute).
  if (html && /data-pm-slice/.test(html)) return false
  const codeEditor = html ? isCodeEditorHtml(html, types) : false
  if (html && !codeEditor) return false
  const schema = view.state.schema

  const rows = parseDelimited(text)
  if (rows && !looksLikeMarkdown(text)) {
    insertDoc(view, Fragment.from(tableFromRows(schema, rows)))
    return true
  }
  if (looksLikeMarkdown(text)) {
    try {
      const { doc } = getCodec(schema).parse(text)
      insertDoc(view, doc.content)
      return true
    } catch (e) {
      console.error('markdown paste parse failed:', e)
      return false
    }
  }
  if (codeEditor) {
    // Plain code/prose from an editor: insert as text lines, not styled HTML.
    const paras = text.replace(/\r\n?/g, '\n').split('\n').map(l =>
      schema.nodes.paragraph.create(null, l ? schema.text(l) : null))
    insertDoc(view, Fragment.from(paras))
    return true
  }
  return false
}

/** Clean HTML from chat apps, Google Docs and code editors before parsing. */
export function cleanPastedHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  // Our own image copies carry the original markdown src.
  doc.querySelectorAll('img[data-quill-src]').forEach(img => img.setAttribute('src', img.getAttribute('data-quill-src')!))
  // ChatGPT / Claude web: <pre><div>bash</div><div><code>…</code></div></pre>
  // (plus "Copy code" buttons). Keep only the code, and use the label as the language.
  doc.querySelectorAll('pre').forEach(pre => {
    const code = pre.querySelector('code')
    if (!code) return
    const extra = (pre.textContent ?? '').replace(code.textContent ?? '', '').trim()
    if (!extra) return
    let lang = ''
    const cls = /language-([\w+#-]+)/.exec(code.className)?.[1]
    if (cls) lang = cls
    else {
      const label = extra.replace(/copy( code)?|edit|run/gi, '').trim()
      if (/^[\w+#.-]{1,20}$/.test(label)) lang = label
    }
    const fresh = doc.createElement('pre')
    const c = doc.createElement('code')
    if (lang) c.className = `language-${lang.toLowerCase()}`
    c.textContent = code.textContent ?? ''
    fresh.appendChild(c)
    pre.replaceWith(fresh)
  })
  // Monospace spans (Google Docs, Notion, Slack) are inline code.
  doc.querySelectorAll('span[style]').forEach(span => {
    const style = span.getAttribute('style') ?? ''
    if (/font-family:[^;]*(courier|consolas|menlo|monaco|monospace|roboto mono|source code)/i.test(style) && !span.closest('pre')) {
      const c = doc.createElement('code')
      c.textContent = span.textContent
      span.replaceWith(c)
    }
  })
  return doc.body.innerHTML
}

/** Pasted tables without a header row get their first row promoted (GFM needs one). */
export function promoteTableHeaders(slice: Slice, schema: Schema): Slice {
  const header = schema.nodes.tableHeader
  if (!header) return slice
  let changed = false
  const fix = (frag: Fragment): Fragment => {
    const out: PMNode[] = []
    frag.forEach(node => {
      if (node.type.name === 'table' && node.firstChild) {
        const first = node.firstChild
        let allCells = true
        first.forEach(c => { if (c.type.name !== 'tableCell') allCells = false })
        if (allCells && first.childCount) {
          const cells: PMNode[] = []
          first.forEach(c => cells.push(header.create(c.attrs, c.content, c.marks)))
          const rows: PMNode[] = [first.type.create(first.attrs, cells)]
          node.forEach((r, _, i) => { if (i > 0) rows.push(r) })
          out.push(node.type.create(node.attrs, rows, node.marks))
          changed = true
          return
        }
      }
      out.push(node.isLeaf ? node : node.copy(fix(node.content)))
    })
    return Fragment.from(out)
  }
  const content = fix(slice.content)
  return changed ? new Slice(content, slice.openStart, slice.openEnd) : slice
}
