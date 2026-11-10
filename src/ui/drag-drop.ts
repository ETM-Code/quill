// Native file drops. In the Tauri app the window's drag-drop handler sees
// Finder drops before the page (DOM `drop` never fires for files), so they
// arrive as `tauri://drag-*` events with absolute paths:
//   images    -> inserted at the drop point; files outside the document's
//                folder are copied into <doc dir>/assets/ (untitled documents
//                are offered a save first)
//   .md files -> opened (in this window if it is an empty untitled one)
//   others    -> a link to the file is inserted
import type { Editor } from '@tiptap/core'
import { ensureDocumentSaved, imageBaseDir, insertImageNode, altFromFilename } from '../images'
import { dirname } from './link-router'
import { showToast } from './toast'

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif|heic|heif|tiff?|ico)$/i
const MARKDOWN_EXT = /\.(md|markdown|mdown|mkd|mkdn|mdwn|mdx)$/i

export interface DropHost {
  editor: Editor
  docPath: () => string | null
  /** Untitled, unmodified and empty: a dropped document can replace it. */
  isPristine: () => boolean
  loadHere: (path: string) => Promise<unknown>
  openMarkdown: (path: string) => Promise<unknown>
}

/** Markdown-safe relative/absolute URL for a path (spaces, parens escaped). */
export function pathToMarkdownUrl(path: string): string {
  return encodeURI(path).replace(/\(/g, '%28').replace(/\)/g, '%29')
}

function relativeTo(dir: string, path: string): string | null {
  const prefix = dir.endsWith('/') ? dir : `${dir}/`
  return path.startsWith(prefix) ? path.slice(prefix.length) : null
}

function basename(p: string): string {
  return p.split('/').pop() ?? p
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

function dropPos(editor: Editor, point: { x: number; y: number } | null): number {
  if (point) {
    const hit = editor.view.posAtCoords({ left: point.x, top: point.y })
    if (hit) return hit.pos
  }
  return editor.state.selection.from
}

export async function handleDroppedPaths(
  host: DropHost,
  paths: string[],
  point: { x: number; y: number } | null,
): Promise<void> {
  const { editor } = host
  const markdown = paths.filter(p => MARKDOWN_EXT.test(p))
  const images = paths.filter(p => IMAGE_EXT.test(p))
  const others = paths.filter(p => !MARKDOWN_EXT.test(p) && !IMAGE_EXT.test(p))

  if (markdown.length) {
    let rest = markdown
    if (host.isPristine() && images.length === 0 && others.length === 0) {
      await host.loadHere(markdown[0])
      rest = markdown.slice(1)
    }
    for (const p of rest) await host.openMarkdown(p)
  }
  if (!images.length && !others.length) return

  let pos = dropPos(editor, point)
  if (images.length) {
    // Choose the insertion point before a save dialog can steal focus.
    if (!(await ensureDocumentSaved())) return
    const docDir = imageBaseDir() ?? (host.docPath() ? dirname(host.docPath()!) : null)
    if (!docDir) return
    for (const path of images) {
      let src: string | null = relativeTo(docDir, path)
      if (src == null) {
        try {
          src = await invoke<string>('import_asset', { source: path, docDir })
        } catch (e) {
          showToast(`Couldn't add ${basename(path)}: ${e}`, { kind: 'error' })
          continue
        }
      }
      insertImageNode(editor, pathToMarkdownUrl(src), altFromFilename(path), pos)
      pos += 1
    }
  }
  if (others.length) {
    const docPath = host.docPath()
    const docDir = docPath ? dirname(docPath) : null
    const content: unknown[] = []
    others.forEach((path, i) => {
      const rel = docDir ? relativeTo(docDir, path) : null
      const href = pathToMarkdownUrl(rel ?? path)
      if (i > 0) content.push({ type: 'text', text: ' ' })
      content.push({ type: 'text', text: basename(path) || path, marks: [{ type: 'link', attrs: { href } }] })
    })
    editor.chain().focus().insertContentAt(pos, content as never).run()
  }
}

// --- drop caret shown while dragging over the window -----------------------

let caret: HTMLDivElement | null = null

function showCaret(editor: Editor, point: { x: number; y: number }): void {
  const hit = editor.view.posAtCoords({ left: point.x, top: point.y })
  if (!hit) return hideCaret()
  let rect: { left: number; top: number; bottom: number }
  try {
    rect = editor.view.coordsAtPos(hit.pos)
  } catch {
    return hideCaret()
  }
  if (!caret) {
    caret = document.createElement('div')
    caret.className = 'drop-caret'
    document.body.appendChild(caret)
  }
  caret.style.left = `${Math.round(rect.left - 1)}px`
  caret.style.top = `${Math.round(rect.top)}px`
  caret.style.height = `${Math.max(16, Math.round(rect.bottom - rect.top))}px`
  caret.style.display = 'block'
}

function hideCaret(): void {
  if (caret) caret.style.display = 'none'
}

/** Subscribe to the window's native drag-drop events (no-op in a browser). */
export async function installNativeDragDrop(host: DropHost): Promise<void> {
  try {
    const { getCurrentWebview } = await import('@tauri-apps/api/webview')
    const toPoint = (p: { x: number; y: number } | undefined) => {
      if (!p) return null
      const dpr = window.devicePixelRatio || 1
      return { x: p.x / dpr, y: p.y / dpr }
    }
    await getCurrentWebview().onDragDropEvent(event => {
      const payload = event.payload as { type: string; paths?: string[]; position?: { x: number; y: number } }
      const point = toPoint(payload.position)
      if (payload.type === 'over' || payload.type === 'enter') {
        if (point) showCaret(host.editor, point)
      } else if (payload.type === 'drop') {
        hideCaret()
        if (payload.paths?.length) void handleDroppedPaths(host, payload.paths, point)
      } else {
        hideCaret()
      }
    })
  } catch {
    // Browser / VS Code host: DOM drop handling covers it.
  }
}
