function normalizeFiles(files: string[] | undefined): string[] {
  if (!files || files.length === 0) {
    return []
  }

  const seen = new Set<string>()
  const normalized: string[] = []

  for (const file of files) {
    if (typeof file !== 'string') {
      continue
    }

    const trimmed = file.trim()
    if (!trimmed || seen.has(trimmed)) {
      continue
    }

    seen.add(trimmed)
    normalized.push(trimmed)
  }

  return normalized
}

export function selectStartupFiles(
  openedFiles: string[] | undefined,
  pendingFiles: string[],
): string[] {
  const openedCandidates = normalizeFiles(openedFiles)
  if (openedCandidates.length > 0) {
    return openedCandidates
  }

  return normalizeFiles(pendingFiles)
}

export async function openFirstWorkingStartupFile(
  startupFiles: string[],
  openFilePath: (filePath: string) => Promise<boolean>,
  onAttempt?: (filePath: string) => void,
): Promise<string | null> {
  for (const startupFile of startupFiles) {
    onAttempt?.(startupFile)
    if (await openFilePath(startupFile)) {
      return startupFile
    }
  }

  return null
}
