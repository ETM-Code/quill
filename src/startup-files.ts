export function selectStartupFiles(
  openedFiles: string[] | undefined,
  pendingFiles: string[],
): string[] {
  if (openedFiles && openedFiles.length > 0) {
    return openedFiles
  }
  return pendingFiles
}
