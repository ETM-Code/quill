// Hover affordances for links and images:
//  - holding ⌘ (Ctrl elsewhere) puts `quill-mod-held` on the editor wrapper,
//    so CSS can switch links/images to a pointer cursor and an underline;
//  - hovering a link sets a native tooltip ("⌘-click to open <href>").
// Attributes go on the wrapper around view.dom, never on ProseMirror-managed
// DOM, so the DOM observer never sees them (no re-read, zero doc cost).
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

export const linkHintsKey = new PluginKey('quillLinkHints')

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl'

export function describeHref(href: string): string {
  if (href.startsWith('#')) return `Jump to “${href.slice(1)}”`
  if (/^(https?:|mailto:|tel:)/i.test(href)) return href
  return href
}

export function linkTooltip(href: string): string {
  return `${describeHref(href)}\n${MOD_LABEL}-click to open`
}

export function linkHintsPlugin(): Plugin {
  return new Plugin({
    key: linkHintsKey,
    view(view: EditorView) {
      const host = (view.dom.parentElement ?? view.dom) as HTMLElement
      let modHeld = false
      const setMod = (on: boolean) => {
        if (on === modHeld) return
        modHeld = on
        host.classList.toggle('quill-mod-held', on)
      }
      const onKey = (e: KeyboardEvent) => setMod(IS_MAC ? e.metaKey : e.ctrlKey)
      const onBlur = () => setMod(false)
      let titled = false
      const onOver = (e: MouseEvent) => {
        setMod(IS_MAC ? e.metaKey : e.ctrlKey)
        const target = e.target as HTMLElement | null
        const a = target?.closest?.('a[href]') as HTMLAnchorElement | null
        if (a && view.dom.contains(a)) {
          host.title = linkTooltip(a.getAttribute('href') ?? '')
          titled = true
        } else if (target?.closest?.('img.quill-image') && view.dom.contains(target)) {
          host.title = `Click for options · ${MOD_LABEL}-click or double-click to open`
          titled = true
        } else if (titled) {
          host.removeAttribute('title')
          titled = false
        }
      }
      window.addEventListener('keydown', onKey, true)
      window.addEventListener('keyup', onKey, true)
      window.addEventListener('blur', onBlur)
      host.addEventListener('mouseover', onOver)
      return {
        destroy() {
          window.removeEventListener('keydown', onKey, true)
          window.removeEventListener('keyup', onKey, true)
          window.removeEventListener('blur', onBlur)
          host.removeEventListener('mouseover', onOver)
          host.classList.remove('quill-mod-held')
          if (titled) host.removeAttribute('title')
        },
      }
    },
  })
}
