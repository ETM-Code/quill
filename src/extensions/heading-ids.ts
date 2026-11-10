// GitHub-style heading anchors: every heading gets an `id` (via a node
// decoration, so nothing is stored in the document or the markdown) and
// `#anchor` links can find their target.
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'

/** GitHub's slug rules: lowercase, drop punctuation, each space -> "-". */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/\s/g, '-')
}

export interface HeadingInfo {
  pos: number
  level: number
  text: string
  slug: string
}

/** All headings in document order, with de-duplicated slugs (x, x-1, x-2). */
export function collectHeadings(doc: PMNode): HeadingInfo[] {
  const out: HeadingInfo[] = []
  const seen = new Map<string, number>()
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      const text = node.textContent
      const base = slugify(text)
      const n = seen.get(base) ?? 0
      seen.set(base, n + 1)
      out.push({ pos, level: node.attrs.level as number, text, slug: n === 0 ? base : `${base}-${n}` })
      return false
    }
    // Headings only live in block containers; skip inline content.
    return !node.isTextblock
  })
  return out
}

/** Position of the heading an `#anchor` points at, or null. */
export function findHeadingBySlug(doc: PMNode, anchor: string): number | null {
  let wanted = anchor.replace(/^#/, '')
  try {
    wanted = decodeURIComponent(wanted)
  } catch {
    // keep raw
  }
  const headings = collectHeadings(doc)
  const exact = headings.find(h => h.slug === wanted)
  if (exact) return exact.pos
  // Be forgiving about case and hand-written anchors ("#Heading Two").
  const loose = slugify(wanted)
  const fuzzy = headings.find(h => h.slug === loose || h.slug === wanted.toLowerCase())
  return fuzzy ? fuzzy.pos : null
}

export const headingIdsKey = new PluginKey<DecorationSet>('quillHeadingIds')

function build(doc: PMNode): DecorationSet {
  const decos = collectHeadings(doc).map(h => {
    const node = doc.nodeAt(h.pos)!
    return Decoration.node(h.pos, h.pos + node.nodeSize, { id: h.slug })
  })
  return DecorationSet.create(doc, decos)
}

export function headingIdsPlugin(): Plugin {
  return new Plugin<DecorationSet>({
    key: headingIdsKey,
    state: {
      init: (_, state) => build(state.doc),
      apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old),
    },
    props: {
      decorations(state) {
        return headingIdsKey.getState(state)
      },
    },
  })
}
