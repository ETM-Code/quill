import type { Editor } from '@tiptap/core'

type BlockMathFenceRange = {
  start: number
  end: number
  latex: string
}

type TransactionLike = {
  docChanged?: boolean
  steps?: Array<{ toJSON?: () => unknown }>
}

function isFence(text: string): boolean {
  return text.trim() === '$$'
}

function isTextParagraph(nodeName: string): boolean {
  return nodeName === 'paragraph'
}

export function findFencedBlockMathRanges(blocks: string[]): BlockMathFenceRange[] {
  const ranges: BlockMathFenceRange[] = []

  let i = 0
  while (i < blocks.length) {
    if (!isFence(blocks[i])) {
      i += 1
      continue
    }

    let j = i + 1
    while (j < blocks.length && !isFence(blocks[j])) {
      j += 1
    }

    // Need both opening and closing fence with at least one block between them.
    if (j >= blocks.length || j === i + 1) {
      i += 1
      continue
    }

    const latex = blocks
      .slice(i + 1, j)
      .join('\n')
      .trim()

    if (latex.length > 0) {
      ranges.push({
        start: i,
        end: j,
        latex,
      })
    }

    i = j + 1
  }

  return ranges
}

function posOfTopLevelChild(doc: Editor['state']['doc'], index: number): number {
  let pos = 0
  for (let i = 0; i < index; i += 1) {
    pos += doc.child(i).nodeSize
  }
  return pos
}

function containsDollarSign(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.includes('$')
  }

  if (Array.isArray(value)) {
    return value.some(containsDollarSign)
  }

  if (value && typeof value === 'object') {
    return Object.values(value).some(containsDollarSign)
  }

  return false
}

export function shouldRunMathMigrationForTransaction(transaction: TransactionLike): boolean {
  if (!transaction.docChanged) {
    return false
  }

  const steps = transaction.steps ?? []
  if (steps.length === 0) {
    return false
  }

  return steps.some(step => {
    if (!step || typeof step.toJSON !== 'function') {
      return false
    }
    return containsDollarSign(step.toJSON())
  })
}

export function extractBlockMathLatex(text: string): string | null {
  const match = text.trim().match(/^\$\$([\s\S]*?)\$\$$/)
  if (!match) {
    return null
  }

  const latex = match[1].trim()
  return latex.length > 0 ? latex : null
}

type InlineMathRange = {
  start: number
  end: number
  latex: string
}

export function findInlineMathRanges(text: string): InlineMathRange[] {
  const ranges: InlineMathRange[] = []

  let i = 0
  while (i < text.length) {
    if (text[i] !== '$') {
      i += 1
      continue
    }

    const prev = i > 0 ? text[i - 1] : ''
    const next = i + 1 < text.length ? text[i + 1] : ''
    if (prev === '$' || next === '$') {
      i += 1
      continue
    }

    let j = i + 1
    while (j < text.length) {
      if (text[j] !== '$') {
        j += 1
        continue
      }

      const closePrev = j > 0 ? text[j - 1] : ''
      const closeNext = j + 1 < text.length ? text[j + 1] : ''
      if (closePrev === '$' || closeNext === '$') {
        j += 1
        continue
      }

      const latex = text.slice(i + 1, j).trim()
      if (latex.length > 0 && !/^\d+$/.test(latex)) {
        ranges.push({ start: i, end: j + 1, latex })
      }
      i = j + 1
      break
    }

    if (j >= text.length) {
      i += 1
    }
  }

  return ranges
}

export function stripSingleDollarWrappers(
  left: string,
  right: string,
): { left: string; right: string } | null {
  if (!left.endsWith('$') || !right.startsWith('$')) {
    return null
  }

  return {
    left: left.slice(0, -1),
    right: right.slice(1),
  }
}

export function migrateInlineMathText(editor: Editor): void {
  const inlineMath = editor.schema.nodes.inlineMath
  if (!inlineMath) {
    return
  }

  const tr = editor.state.tr
  let changed = false

  tr.doc.descendants((node, pos) => {
    if (!node.isText || !node.text || !node.text.includes('$')) {
      return
    }

    const ranges = findInlineMathRanges(node.text)
    if (ranges.length === 0) {
      return
    }

    for (const range of [...ranges].reverse()) {
      const from = tr.mapping.map(pos + range.start)
      const to = tr.mapping.map(pos + range.end)

      const $from = tr.doc.resolve(from)
      const parent = $from.parent
      const index = $from.index()

      if (!parent.canReplaceWith(index, index + 1, inlineMath)) {
        continue
      }

      tr.replaceWith(from, to, inlineMath.create({ latex: range.latex }))
      changed = true
    }
  })

  if (changed) {
    tr.setMeta('addToHistory', false)
    editor.view.dispatch(tr)
  }
}

export function cleanupInlineMathDoubleDollarArtifacts(editor: Editor): void {
  const inlineMath = editor.schema.nodes.inlineMath
  if (!inlineMath) {
    return
  }

  const replacements: Array<{ from: number; to: number; node: any }> = []

  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'paragraph' || node.childCount < 3) {
      return
    }

    const newChildren: any[] = []
    let localChanged = false
    let i = 0

    while (i < node.childCount) {
      const left = node.child(i)
      const middle = i + 1 < node.childCount ? node.child(i + 1) : null
      const right = i + 2 < node.childCount ? node.child(i + 2) : null

      if (
        left.isText
        && middle?.type.name === 'inlineMath'
        && right?.isText
        && left.text
        && right.text
      ) {
        const stripped = stripSingleDollarWrappers(left.text, right.text)
        if (stripped) {
          if (stripped.left.length > 0) {
            newChildren.push(editor.schema.text(stripped.left, left.marks))
          }
          newChildren.push(middle)
          if (stripped.right.length > 0) {
            newChildren.push(editor.schema.text(stripped.right, right.marks))
          }
          localChanged = true
          i += 3
          continue
        }
      }

      newChildren.push(left)
      i += 1
    }

    if (localChanged) {
      replacements.push({
        from: pos,
        to: pos + node.nodeSize,
        node: node.type.create(node.attrs, newChildren, node.marks),
      })
    }
  })

  if (replacements.length === 0) {
    return
  }

  let tr = editor.state.tr
  for (const replacement of replacements.reverse()) {
    tr = tr.replaceWith(replacement.from, replacement.to, replacement.node)
  }

  tr.setMeta('addToHistory', false)
  editor.view.dispatch(tr)
}

export function migrateBlockMathParagraphs(editor: Editor): void {
  const blockMath = editor.schema.nodes.blockMath
  if (!blockMath) {
    return
  }

  let tr = editor.state.tr
  let changed = false

  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'paragraph') {
      return
    }

    const latex = extractBlockMathLatex(node.textContent)
    if (!latex) {
      return
    }

    const from = tr.mapping.map(pos)
    const mappedNode = tr.doc.nodeAt(from)
    if (!mappedNode || mappedNode.type.name !== 'paragraph') {
      return
    }

    const $from = tr.doc.resolve(from)
    const parent = $from.parent
    const index = $from.index()

    if (!parent.canReplaceWith(index, index + 1, blockMath)) {
      return
    }

    tr = tr.replaceWith(from, from + mappedNode.nodeSize, blockMath.create({ latex }))
    changed = true
  })

  if (changed) {
    tr.setMeta('addToHistory', false)
    editor.view.dispatch(tr)
  }
}

export function migrateFencedBlockMathParagraphs(editor: Editor): void {
  const blockMath = editor.schema.nodes.blockMath
  if (!blockMath) {
    return
  }

  let tr = editor.state.tr
  let changed = false

  const blockTexts: string[] = []
  const eligible: boolean[] = []
  for (let i = 0; i < tr.doc.childCount; i += 1) {
    const child = tr.doc.child(i)
    blockTexts.push(child.textContent)
    eligible.push(isTextParagraph(child.type.name))
  }

  const ranges = findFencedBlockMathRanges(blockTexts)
    .filter(range => {
      for (let i = range.start; i <= range.end; i += 1) {
        if (!eligible[i]) {
          return false
        }
      }
      return true
    })
    .reverse()

  for (const range of ranges) {
    const from = posOfTopLevelChild(tr.doc, range.start)
    const to = posOfTopLevelChild(tr.doc, range.end + 1)
    if (to <= from) {
      continue
    }

    tr = tr.replaceWith(from, to, blockMath.create({ latex: range.latex }))
    changed = true
  }

  if (changed) {
    tr.setMeta('addToHistory', false)
    editor.view.dispatch(tr)
  }
}

export function migrateAllMathStrings(editor: Editor): void {
  if (!editor.state.doc.textContent.includes('$')) {
    return
  }

  cleanupInlineMathDoubleDollarArtifacts(editor)
  migrateInlineMathText(editor)
  migrateBlockMathParagraphs(editor)
  migrateFencedBlockMathParagraphs(editor)
}
