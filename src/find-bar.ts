export function getFindShortcutMode(isOpen: boolean): 'open' | 'close' {
  return isOpen ? 'close' : 'open'
}

export function shouldCloseFindBarFromDocumentClick({
  isOpen,
  clickedInsideFindBar,
}: {
  isOpen: boolean
  clickedInsideFindBar: boolean
}): boolean {
  return isOpen && !clickedInsideFindBar
}
