export function shouldBlockWindowClose(isModified: boolean, confirmed: boolean): boolean {
  if (!isModified) {
    return false
  }

  return !confirmed
}
