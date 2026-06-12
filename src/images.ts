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
}

const ctx: ImageContext = { baseDir: null, saver: async () => null }

export function configureImages(next: Partial<ImageContext>): void {
  Object.assign(ctx, next)
}

function isExternalSrc(src: string): boolean {
  return /^(https?:|data:|blob:|asset:|tauri:|file:)/i.test(src)
}

function isAbsolute(p: string): boolean {
  return p.startsWith('/') || /^[a-zA-Z]:[/\\]/.test(p)
}

function joinPath(dir: string, rel: string): string {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
  return `${dir.replace(/[/\\]+$/, '')}${sep}${rel.replace(/^[/\\]+/, '')}`
}

/** Map a stored markdown src to a URL the webview can actually load. */
export function resolveForDisplay(src: string): string {
  if (!src || isExternalSrc(src)) return src
  if (ctx.resolveLocal) {
    const resolved = ctx.resolveLocal(src, ctx.baseDir)
    if (resolved) return resolved
  }
  const abs = isAbsolute(src) ? src : ctx.baseDir ? joinPath(ctx.baseDir, src) : null
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
    return () => {
      const dom = document.createElement('img')
      dom.className = 'quill-image'
      const apply = (n: { attrs: { src?: string; alt?: string | null; title?: string | null } }) => {
        dom.setAttribute('src', resolveForDisplay(n.attrs.src ?? ''))
        if (n.attrs.alt) dom.setAttribute('alt', n.attrs.alt)
        else dom.removeAttribute('alt')
        if (n.attrs.title) dom.setAttribute('title', n.attrs.title)
        else dom.removeAttribute('title')
      }
      return {
        dom,
        // ProseMirror calls the renderer with the node bound; mirror that here.
        update(updated: { type: { name: string }; attrs: { src?: string; alt?: string | null; title?: string | null } }) {
          if (updated.type.name !== 'image') return false
          apply(updated)
          return true
        },
        _init: dom,
      }
    }
  },
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

/** Save bytes through the configured saver and insert an image node. */
export async function insertImageBytes(editor: Editor, bytes: Uint8Array, ext: string): Promise<void> {
  const src = await ctx.saver(bytes, ext)
  if (!src) return
  editor.chain().focus().insertContent({ type: 'image', attrs: { src, alt: null, title: null } }).run()
}

async function insertImageFile(editor: Editor, file: File): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  await insertImageBytes(editor, bytes, extFor(file.type))
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
