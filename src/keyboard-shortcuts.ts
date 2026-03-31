export type ShortcutAction =
  | 'save'
  | 'open'
  | 'new'
  | 'find'
  | 'findNext'
  | 'findPrevious'
  | 'print'
  | 'closeWindow'

export function getShortcutAction(
  event: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean },
  lastFindQuery: string,
): ShortcutAction | null {
  const isMod = event.metaKey || event.ctrlKey
  if (!isMod) {
    return null
  }

  const key = event.key.toLowerCase()
  if (key === 's') return 'save'
  if (key === 'o') return 'open'
  if (key === 'n') return 'new'
  if (key === 'f') return 'find'
  if (key === 'p') return 'print'
  if (key === 'w') return 'closeWindow'
  if (key === 'g' && lastFindQuery) {
    return event.shiftKey ? 'findPrevious' : 'findNext'
  }

  return null
}
