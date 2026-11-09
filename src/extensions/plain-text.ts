// Copy as Plain Text (⌥⇧⌘C, Edit menu): the selection as rendered text with
// no markdown syntax. Blocks are separated by a blank line, list items get one
// line each ("• " / "1. ", nested items indented two spaces), table rows
// become tab-separated lines (spreadsheet-friendly), math becomes its LaTeX,
// images their alt text, code its raw text. Only text/plain is written.
import type { Editor } from '@tiptap/core'
import type { Fragment, Node as PMNode } from '@tiptap/pm/model'

function inlineNodeText(child: PMNode): string {
  if (child.isText) return child.text ?? ''
  if (child.type.name === 'hardBreak') return '\n'
  if (child.type.name === 'inlineMath') return (child.attrs.latex as string) ?? ''
  if (child.type.name === 'image') return (child.attrs.alt as string | null) ?? ''
  if (child.isInline) return child.textContent
  return blockText(child, 0)
}

function inlineText(node: PMNode): string {
  let out = ''
  node.forEach(child => {
    out += inlineNodeText(child)
  })
  return out
}

function listText(list: PMNode, depth: number): string {
  const lines: string[] = []
  const ordered = list.type.name === 'orderedList'
  let n = (list.attrs.start as number | undefined) ?? 1
  list.forEach(item => {
    const indent = '  '.repeat(depth)
    const marker = ordered ? `${n++}. ` : '• '
    const parts: string[] = []
    let first = true
    item.forEach(child => {
      if (/^(bulletList|orderedList|taskList)$/.test(child.type.name)) {
        parts.push(listText(child, depth + 1))
      } else {
        const text = blockText(child, depth).split('\n').join(`\n${indent}  `)
        parts.push(first ? `${indent}${marker}${text}` : `${indent}  ${text}`)
        first = false
      }
    })
    if (first) parts.unshift(`${indent}${marker}`.trimEnd())
    lines.push(parts.join('\n'))
  })
  return lines.join('\n')
}

function tableText(table: PMNode): string {
  const rows: string[] = []
  table.forEach(row => {
    const cells: string[] = []
    row.forEach(cell => {
      const parts: string[] = []
      cell.forEach(block => parts.push(blockText(block, 0)))
      cells.push(parts.join(' ').replace(/[\t\n]+/g, ' ').trim())
    })
    rows.push(cells.join('\t'))
  })
  return rows.join('\n')
}

function blockText(node: PMNode, depth: number): string {
  switch (node.type.name) {
    case 'paragraph':
    case 'heading':
      return inlineText(node)
    case 'codeBlock':
      return node.textContent
    case 'blockMath':
      return (node.attrs.latex as string) ?? ''
    case 'mermaid':
      return (node.attrs.code as string) ?? node.textContent
    case 'horizontalRule':
      return ''
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return listText(node, depth)
    case 'table':
      return tableText(node)
    case 'image':
      return (node.attrs.alt as string | null) ?? ''
    default:
      if (node.isTextblock) return inlineText(node)
      if (node.isLeaf) return node.textContent
      return fragmentText(node.content, depth)
  }
}

/** Plain text for a fragment of block (or inline) content. */
export function fragmentText(fragment: Fragment, depth = 0): string {
  const blocks: string[] = []
  let inline = ''
  fragment.forEach(node => {
    if (node.isInline) {
      inline += inlineNodeText(node)
      return
    }
    if (inline) {
      blocks.push(inline)
      inline = ''
    }
    const text = blockText(node, depth)
    if (text !== '') blocks.push(text)
  })
  if (inline) blocks.push(inline)
  return blocks.join('\n\n')
}

/** Plain text of the editor's current selection (empty selection: ''). */
export function selectionPlainText(editor: Editor): string {
  const { selection } = editor.state
  if (selection.empty) return ''
  return fragmentText(selection.content().content)
}

/**
 * Write text/plain only. navigator.clipboard first; if that is unavailable or
 * rejects, a hidden textarea + execCommand('copy'), whose copy event is also
 * forced to plain text.
 */
export function writePlainTextToClipboard(text: string): void {
  const fallback = () => {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'
    const active = document.activeElement as HTMLElement | null
    document.body.appendChild(ta)
    ta.select()
    const onCopy = (e: ClipboardEvent) => {
      e.clipboardData?.setData('text/plain', text)
      e.preventDefault()
    }
    document.addEventListener('copy', onCopy, true)
    try {
      document.execCommand('copy')
    } finally {
      document.removeEventListener('copy', onCopy, true)
      ta.remove()
      active?.focus()
    }
  }
  try {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(fallback)
      return
    }
  } catch {
    // fall through
  }
  fallback()
}

export function copyAsPlainText(editor: Editor): boolean {
  const text = selectionPlainText(editor)
  if (!text) return false
  writePlainTextToClipboard(text)
  return true
}
