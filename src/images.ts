// Image support: markdown round-trip, rendering local files through the Tauri
// asset protocol, and paste/drop that writes the bytes to disk next to the
// document. The editor core stays host-agnostic: the actual file writing is
// injected by FileOps via configureImages(); this module only reaches Tauri
// through the global convertFileSrc shim (also provided by the test harness).
import Image from '@tiptap/extension-image'
import type { Editor } from '@tiptap/core'

/**
 * Persist image bytes and return the markdown `src` to store (e.g.
 * "assets/img-ab12cd34.png"), or null if it could not be saved (for example
 * the document is unsaved). Implementations show their own toast on failure.
 */
export type ImageSaver = (bytes: Uint8Array, ext: string) => Promise<string | null>

interface ImageContext {
  /** Directory of the current document; relative srcs resolve against it. */
  baseDir: string | null
  saver: ImageSaver
  /**
   * Host override for turning a local markdown src into a loadable URL. Tauri
   * leaves this unset and uses convertFileSrc (below); the VS Code host injects
   * one that builds webview URIs. Return null to fall back to the default.
   */
  resolveLocal?: (src: string, baseDir: string | null) => string | null
  /**
   * Called before saving image bytes when the document has never been saved
   * (no baseDir): the host prompts to save, and resolves true once a path
   * exists. Unset means the saver decides on its own (shows a toast).
   */
  ensureSaved?: () => Promise<boolean>
}

const ctx: ImageContext = { baseDir: null, saver: async () => null }

export function configureImages(next: Partial<ImageContext>): void {
  Object.assign(ctx, next)
}

/** Directory of the current document (null while untitled). */
export function imageBaseDir(): string | null {
  return ctx.baseDir
}

/** Prompt-to-save gate shared by paste, drop and the image dialog. */
export async function ensureDocumentSaved(): Promise<boolean> {
  if (ctx.baseDir) return true
  if (!ctx.ensureSaved) return true // let the saver report it
  return ctx.ensureSaved()
}

export function isExternalSrc(src: string): boolean {
  return /^(https?:|data:|blob:|asset:|tauri:|file:)/i.test(src)
}

function isAbsolute(p: string): boolean {
  return p.startsWith('/') || /^[a-zA-Z]:[/\\]/.test(p)
}

function joinPath(dir: string, rel: string): string {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
  return `${dir.replace(/[/\\]+$/, '')}${sep}${rel.replace(/^[/\\]+/, '')}`
}

function decodePath(p: string): string {
  try {
    return decodeURI(p)
  } catch {
    return p
  }
}

/**
 * Absolute filesystem path for a local image src (relative srcs resolve
 * against the document directory; `%20`-style escapes are decoded), or null
 * for remote/data srcs and relative srcs in an untitled document.
 */
export function localImagePath(src: string): string | null {
  if (!src) return null
  if (/^file:/i.test(src)) {
    try {
      return decodeURIComponent(new URL(src).pathname)
    } catch {
      return null
    }
  }
  if (isExternalSrc(src)) return null
  const clean = decodePath(src.replace(/[?#].*$/, ''))
  if (isAbsolute(clean)) return clean
  return ctx.baseDir ? normalizePath(joinPath(ctx.baseDir, clean)) : null
}

function normalizePath(p: string): string {
  const out: string[] = []
  for (const part of p.split('/')) {
    if (part === '.' || (part === '' && out.length > 0)) continue
    if (part === '..' && out.length > 1) out.pop()
    else out.push(part)
  }
  return out.join('/') || '/'
}

/** Map a stored markdown src to a URL the webview can actually load. */
export function resolveForDisplay(src: string): string {
  if (!src || isExternalSrc(src)) return src
  if (ctx.resolveLocal) {
    const resolved = ctx.resolveLocal(src, ctx.baseDir)
    if (resolved) return resolved
  }
  const abs = localImagePath(src)
  if (!abs) return src
  try {
    const convert = (window as { __TAURI_INTERNALS__?: { convertFileSrc?: (p: string) => string } })
      .__TAURI_INTERNALS__?.convertFileSrc
    if (typeof convert === 'function') return convert(abs)
  } catch {
    // No Tauri (plain browser): fall back to the raw src.
  }
  return src
}

// Image is the standard markdown image. We keep `src` markdown-faithful (the
// relative path / URL exactly as written) and only swap in a loadable URL at
// render time via the node view, so serialization round-trips cleanly.
const imageConfig = {
  markdownName: 'image',
  parseMarkdown(token: { href?: string; text?: string; title?: string | null }) {
    return {
      type: 'image',
      attrs: {
        src: token.href ?? '',
        alt: token.text || null,
        title: token.title || null,
      },
    }
  },
  renderMarkdown(node: { attrs?: { src?: string; alt?: string | null; title?: string | null } }) {
    const src = node.attrs?.src ?? ''
    const alt = node.attrs?.alt ?? ''
    const title = node.attrs?.title
    return `![${alt}](${src}${title ? ` "${title}"` : ''})`
  },
  addNodeView() {
    return ({ node, getPos, editor }: { node: ImageNodeLike; getPos: () => number | undefined; editor: Editor }) =>
      createImageNodeView(node, getPos, editor)
  },
}

interface ImageNodeLike {
  type: { name: string }
  attrs: { src?: string; alt?: string | null; title?: string | null; width?: number | string | null }
}

// Inline image node view: <span.quill-image-wrap><img/><span.handle/></span>.
// The corner handle resizes the width (aspect ratio preserved); the value is
// stored in the node's `width` attribute (rendered as <img width> by the
// markdown serializer). Clicks/double-clicks are handled by the
// image-interactions plugin in src/extensions.
function createImageNodeView(node: ImageNodeLike, getPos: () => number | undefined, editor: Editor) {
  const dom = document.createElement('span')
  dom.className = 'quill-image-wrap'
  const img = document.createElement('img')
  img.className = 'quill-image'
  img.draggable = false
  const handle = document.createElement('span')
  handle.className = 'quill-image-handle'
  handle.title = 'Drag to resize'
  dom.append(img, handle)

  const apply = (n: ImageNodeLike) => {
    img.setAttribute('src', resolveForDisplay(n.attrs.src ?? ''))
    if (n.attrs.alt) img.setAttribute('alt', n.attrs.alt)
    else img.removeAttribute('alt')
    if (n.attrs.title) img.setAttribute('title', n.attrs.title)
    else img.removeAttribute('title')
    const w = Number.parseInt(String(n.attrs.width ?? ''), 10)
    img.style.width = Number.isFinite(w) && w > 0 ? `${w}px` : ''
  }
  apply(node)

  handle.addEventListener('mousedown', e => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = img.getBoundingClientRect().width
    const maxW = (dom.closest('.tiptap') as HTMLElement | null)?.clientWidth ?? 2000
    dom.classList.add('resizing')
    const move = (ev: MouseEvent) => {
      const w = Math.max(40, Math.min(maxW, startW + ev.clientX - startX))
      img.style.width = `${Math.round(w)}px`
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      dom.classList.remove('resizing')
      const pos = getPos()
      if (pos == null) return
      const width = Math.round(img.getBoundingClientRect().width)
      const current = editor.state.doc.nodeAt(pos)
      if (!current || current.type.name !== 'image') return
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, width, height: null }),
      )
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  })

  return {
    dom,
    update(updated: ImageNodeLike) {
      if (updated.type.name !== 'image') return false
      apply(updated)
      return true
    },
    ignoreMutation() {
      return true
    },
    stopEvent(event: Event) {
      return event.target === handle
    },
  }
}

// extend() rejects unknown config keys at the type level; markdownName /
// parseMarkdown / renderMarkdown are read at runtime by @tiptap/markdown.
export const QuillImage = Image.extend(imageConfig as never).configure({ inline: true })

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/heif': 'heif',
}

function extFor(mime: string): string {
  return EXT_BY_MIME[mime.toLowerCase()] ?? 'png'
}

/** Alt text guess from a file name: "my_chart-v2.png" -> "my chart v2". */
export function altFromFilename(name: string): string | null {
  const base = name.split(/[/\\]/).pop() ?? ''
  const stem = base.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim()
  if (!stem || /^(img|image|screen ?shot|pasted|clipboard)(\s*[-\d]|\s+at\s|$)/i.test(stem)) return null
  return stem
}

/** Insert an image node at `pos` (or the selection). */
export function insertImageNode(editor: Editor, src: string, alt: string | null = null, pos?: number): void {
  const content = { type: 'image', attrs: { src, alt, title: null } }
  const chain = editor.chain().focus()
  if (pos != null) chain.insertContentAt(pos, content).run()
  else chain.insertContent(content).run()
}

/**
 * Save bytes through the configured saver and insert an image node. An
 * untitled document is offered a save first (ensureSaved) instead of
 * dropping the image.
 */
export async function insertImageBytes(
  editor: Editor,
  bytes: Uint8Array,
  ext: string,
  opts: { alt?: string | null; pos?: number } = {},
): Promise<void> {
  if (!(await ensureDocumentSaved())) return
  const src = await ctx.saver(bytes, ext)
  if (!src) return
  insertImageNode(editor, src, opts.alt ?? null, opts.pos)
}

async function insertImageFile(editor: Editor, file: File): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  await insertImageBytes(editor, bytes, extFor(file.type), { alt: altFromFilename(file.name) })
}

function imageFilesFrom(dt: DataTransfer | null): File[] {
  if (!dt) return []
  const out: File[] = []
  for (const f of Array.from(dt.files)) {
    if (f.type.startsWith('image/')) out.push(f)
  }
  if (out.length === 0) {
    for (const item of Array.from(dt.items ?? [])) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile()
        if (f) out.push(f)
      }
    }
  }
  return out
}

/** Handle a clipboard paste of image data. Returns true if it was consumed. */
export function handleImagePaste(editor: Editor, event: ClipboardEvent): boolean {
  const files = imageFilesFrom(event.clipboardData)
  if (files.length === 0) return false
  event.preventDefault()
  void (async () => {
    for (const f of files) await insertImageFile(editor, f)
  })()
  return true
}

/** Handle a drag-drop of image files. Returns true if it was consumed. */
export function handleImageDrop(editor: Editor, event: DragEvent): boolean {
  const files = imageFilesFrom(event.dataTransfer)
  if (files.length === 0) return false
  event.preventDefault()
  const pos = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })
  if (pos) editor.commands.setTextSelection(pos.pos)
  void (async () => {
    for (const f of files) await insertImageFile(editor, f)
  })()
  return true
}
