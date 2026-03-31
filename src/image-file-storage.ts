function normalizePathSeparators(path: string): string {
  return path.replace(/\\/g, '/')
}

function getDirname(path: string): string {
  const normalized = normalizePathSeparators(path)
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash <= 0) {
    return lastSlash === 0 ? '/' : '.'
  }
  return normalized.slice(0, lastSlash)
}

function getBasename(path: string): string {
  const normalized = normalizePathSeparators(path)
  const lastSlash = normalized.lastIndexOf('/')
  return lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized
}

function stripFinalExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.')
  if (lastDot <= 0) {
    return filename
  }
  return filename.slice(0, lastDot)
}

function getExtensionFromName(filename: string): string | null {
  const basename = getBasename(filename)
  const lastDot = basename.lastIndexOf('.')
  if (lastDot <= 0 || lastDot === basename.length - 1) {
    return null
  }
  return basename.slice(lastDot + 1).toLowerCase()
}

function getExtensionFromMimeType(mimeType: string): string | null {
  switch (mimeType.toLowerCase()) {
    case 'image/png':
      return 'png'
    case 'image/jpeg':
      return 'jpg'
    case 'image/gif':
      return 'gif'
    case 'image/webp':
      return 'webp'
    case 'image/svg+xml':
      return 'svg'
    case 'image/heic':
      return 'heic'
    case 'image/heif':
      return 'heif'
    default:
      return null
  }
}

function sanitizeBaseName(filename: string): string {
  const base = stripFinalExtension(getBasename(filename))
  const sanitized = base
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return sanitized || 'pasted-image'
}

export function getImageAssetDirectory(markdownFilePath: string): string {
  const directory = getDirname(markdownFilePath)
  const fileBase = stripFinalExtension(getBasename(markdownFilePath))
  return `${directory}/${fileBase}.assets`
}

export function buildImageAssetFilename(input: {
  originalName: string
  mimeType: string
  duplicateIndex: number
}): string {
  const extension = getExtensionFromName(input.originalName)
    ?? getExtensionFromMimeType(input.mimeType)
    ?? 'png'
  const suffix = input.duplicateIndex > 0 ? `-${input.duplicateIndex}` : ''
  return `${sanitizeBaseName(input.originalName)}${suffix}.${extension}`
}

export function getImageMarkdownPath(markdownFilePath: string, assetFilePath: string): string {
  const fromParts = normalizePathSeparators(getDirname(markdownFilePath)).split('/').filter(Boolean)
  const toParts = normalizePathSeparators(assetFilePath).split('/').filter(Boolean)

  let commonLength = 0
  while (
    commonLength < fromParts.length &&
    commonLength < toParts.length &&
    fromParts[commonLength] === toParts[commonLength]
  ) {
    commonLength += 1
  }

  const upwardSegments = fromParts.slice(commonLength).map(() => '..')
  const downwardSegments = toParts.slice(commonLength)
  return [...upwardSegments, ...downwardSegments].join('/')
}
