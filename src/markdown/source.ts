// Source preservation. ProseMirror never mutates nodes: an edit replaces the
// changed node and its ancestors and reuses every untouched node object. So a
// WeakMap from parsed node -> original text tells the serializer exactly which
// parts of the document are unedited and can be written back verbatim.
import type { Node as PMNode } from '@tiptap/pm/model'

/** Raw inline markdown of a paragraph / heading / table cell paragraph. */
export const inlineSources = new WeakMap<PMNode, { src: string; ctx: 'block' | 'cell' }>()

export interface BlockSource {
  load: LoadInfo
  index: number
  src: string
}

export interface LoadInfo {
  id: number
  /** Text before the first block. */
  head: string
  /** Text after the last block (usually the final newline). */
  tail: string
  /** seps[i] = text between block i and block i + 1. */
  seps: string[]
  count: number
  /** Fallback when a node was replaced by an equal copy (undo, re-highlight). */
  originals: PMNode[]
}

const blockSources = new WeakMap<PMNode, BlockSource>()
let loadCounter = 0

export function registerLoad(src: string, spans: Array<{ node: PMNode; from: number; to: number }>): LoadInfo {
  const info: LoadInfo = {
    id: ++loadCounter,
    head: spans.length ? src.slice(0, spans[0].from) : '',
    tail: spans.length ? src.slice(spans[spans.length - 1].to) : src,
    seps: [],
    count: spans.length,
    originals: spans.map(s => s.node),
  }
  spans.forEach((s, i) => {
    if (i + 1 < spans.length) info.seps.push(src.slice(s.to, spans[i + 1].from))
    blockSources.set(s.node, { load: info, index: i, src: src.slice(s.from, s.to) })
  })
  return info
}

/** Original source of a top-level block, if it is unedited. */
export function blockSourceOf(node: PMNode, current: LoadInfo | null): BlockSource | undefined {
  const direct = blockSources.get(node)
  if (direct) return direct
  if (!current) return undefined
  // Equal copy of an original block (e.g. undo restored it, or a code block
  // was re-marked to refresh highlighting).
  for (const orig of current.originals) {
    if (orig.type === node.type && orig.nodeSize === node.nodeSize && orig.eq(node)) {
      const s = blockSources.get(orig)
      if (s) {
        blockSources.set(node, s)
        return s
      }
    }
  }
  return undefined
}

/** Let a replacement node inherit the original's source (same content). */
export function inheritSource(from: PMNode, to: PMNode): void {
  const b = blockSources.get(from)
  if (b) blockSources.set(to, b)
  const i = inlineSources.get(from)
  if (i) inlineSources.set(to, i)
}
