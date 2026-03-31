type MathCommands = {
  updateInlineMath: (options: { latex: string; pos: number }) => boolean
  updateBlockMath: (options: { latex: string; pos: number }) => boolean
}

type EditorMenuState = {
  hasSelectionRange: boolean
  isInParagraph: boolean
  parentText: string
  isInTable: boolean
}

export function applyMathEdit(
  commands: MathCommands,
  kind: 'inline' | 'block',
  promptValue: string | null,
  pos: number,
): boolean {
  if (promptValue == null) {
    return false
  }

  const latex = promptValue.trim()
  if (!latex) {
    return false
  }

  if (kind === 'inline') {
    return commands.updateInlineMath({ latex, pos })
  }

  return commands.updateBlockMath({ latex, pos })
}

export function getEditorMenuMode(input: EditorMenuState): 'hidden' | 'insert' | 'table' {
  if (input.isInTable) {
    return 'table'
  }

  if (input.hasSelectionRange) {
    return 'insert'
  }

  if (!input.isInParagraph) {
    return 'hidden'
  }

  return input.parentText.trim().length === 0 ? 'insert' : 'hidden'
}

export function shouldLazyLoadEditorMenus(input: EditorMenuState): boolean {
  return getEditorMenuMode(input) !== 'hidden'
}
