// Image clicks: plain click selects the image and shows its popover;
// ⌘-click or double-click opens it (Preview / browser). The UI lives in
// main.ts; this plugin only routes events there.
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

export interface ImageHandlers {
  /** Plain click: image at `pos` is now node-selected */
  onSelect: (pos: number, dom: HTMLElement) => void
  /** ⌘-click / double-click */
  onOpen: (pos: number) => void
}

let handlers: ImageHandlers | null = null

export function setImageHandlers(next: ImageHandlers | null): void {
  handlers = next
}

export const imageInteractionsKey = new PluginKey('quillImageInteractions')

function isMod(e: MouseEvent): boolean {
  return /Mac|iPhone|iPad/.test(navigator.platform) ? e.metaKey : e.ctrlKey
}

function imageDom(view: EditorView, pos: number): HTMLElement | null {
  const dom = view.nodeDOM(pos) as HTMLElement | null
  return dom?.querySelector?.('img') ?? dom
}

export function imageInteractionsPlugin(): Plugin {
  return new Plugin({
    key: imageInteractionsKey,
    props: {
      handleClickOn(view, _pos, node, nodePos, event, direct) {
        if (!direct || node.type.name !== 'image') return false
        if ((event.target as HTMLElement).closest('.quill-image-handle')) return true
        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, nodePos)))
        if (isMod(event)) {
          handlers?.onOpen(nodePos)
        } else {
          const dom = imageDom(view, nodePos)
          if (dom) handlers?.onSelect(nodePos, dom)
        }
        return true
      },
      handleDoubleClickOn(_view, _pos, node, nodePos, _event, direct) {
        if (!direct || node.type.name !== 'image') return false
        handlers?.onOpen(nodePos)
        return true
      },
    },
  })
}
