export type ImageAttrs = {
  src: string
  alt: string | null
  title: string | null
}

type PartialImageAttrs = {
  src: string | null
  alt?: string | null
  title?: string | null
}

type ImageCommands = {
  setImage: (attrs: ImageAttrs) => boolean
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value == null) {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function normalizeImageAttrs(input: PartialImageAttrs): ImageAttrs | null {
  const src = normalizeOptionalText(input.src)
  if (!src) {
    return null
  }

  return {
    src,
    alt: normalizeOptionalText(input.alt),
    title: normalizeOptionalText(input.title),
  }
}

export function applyImageInsert(commands: ImageCommands, input: PartialImageAttrs): boolean {
  const attrs = normalizeImageAttrs(input)
  if (!attrs) {
    return false
  }

  return commands.setImage(attrs)
}

function escapeMarkdownText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\]/g, '\\]').replace(/"/g, '\\"')
}

function escapeMarkdownUrl(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\)/g, '\\)')
}

export function renderImageMarkdown(node: { attrs?: Record<string, unknown> | null | undefined }): string {
  const attrs = normalizeImageAttrs({
    src: typeof node.attrs?.src === 'string' ? node.attrs.src : null,
    alt: typeof node.attrs?.alt === 'string' ? node.attrs.alt : null,
    title: typeof node.attrs?.title === 'string' ? node.attrs.title : null,
  })

  if (!attrs) {
    return ''
  }

  const alt = attrs.alt ? escapeMarkdownText(attrs.alt) : ''
  const title = attrs.title ? ` "${escapeMarkdownText(attrs.title)}"` : ''

  return `![${alt}](${escapeMarkdownUrl(attrs.src)}${title})`
}
