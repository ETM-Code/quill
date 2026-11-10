// Mermaid diagram block node for Quill.
// - Stores diagram source in a `code` attribute.
// - Renders via mermaid (lazy-loaded -- the import happens only when a diagram
//   actually needs to render so the base bundle stays small).
// - Click to edit opens a popover (wired by main.ts via onMermaidClick callback).
// - Markdown round-trip lives in src/markdown (```mermaid fences).
// - SVG output from mermaid is sanitized with DOMPurify before innerHTML
//   insertion (belt-and-suspenders on top of mermaid's own securityLevel:strict).
import { Node, mergeAttributes } from '@tiptap/core'
import type { NodeViewRendererProps } from '@tiptap/core'

// Unique counter for mermaid render IDs (mermaid requires unique element IDs).
let mermaidCounter = 0

// Cached mermaid module (resolved on first render, reused thereafter).
type MermaidModule = typeof import('mermaid')
let mermaidPromise: Promise<MermaidModule> | null = null
let mermaidInitialized = false

// Last sanitized SVG per diagram source, for rich copy (text/html).
const svgCache = new Map<string, string>()

export function renderedMermaidSvg(code: string): string | undefined {
  return svgCache.get(code)
}

/** Load mermaid once and initialize it. Theme is set at first load only. */
async function getMermaid(): Promise<MermaidModule> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(m => {
      if (!mermaidInitialized) {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
        m.default.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: prefersDark ? 'dark' : 'default',
          suppressErrorRendering: true,
          // SVG text labels: HTML labels live in <foreignObject>, which the
          // DOMPurify SVG profile strips (boxes rendered without text).
          htmlLabels: false,
          flowchart: { htmlLabels: false },
        })
        mermaidInitialized = true
      }
      return m
    })
  }
  return mermaidPromise
}

/** Render a mermaid diagram string to an SVG string, or null on error. */
async function renderDiagram(code: string): Promise<{ svg: string } | { error: string }> {
  try {
    const mermaid = await getMermaid()
    const id = `mermaid-${++mermaidCounter}`
    const { svg } = await mermaid.default.render(id, code)
    return { svg }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

export interface MermaidClickEvent {
  code: string
  pos: number
}

// The extension stores onMermaidClick as a global so the nodeView can call it.
// (NodeView constructors only receive the props object from Tiptap, not custom
// callbacks, so we route the click through a module-level handler just like the
// math extensions do via their configure() option.)
let globalOnClick: ((code: string, pos: number) => void) | null = null

export function setMermaidClickHandler(fn: (code: string, pos: number) => void): void {
  globalOnClick = fn
}

export const QuillMermaid = Node.create({
  name: 'mermaid',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      code: {
        default: 'graph TD\n  A[Start] --> B[End]',
        parseHTML: el => el.getAttribute('data-code') ?? '',
        renderHTML: attrs => ({ 'data-code': attrs.code }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="mermaid"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'mermaid' })]
  },

  // ---------------------------------------------------------------------------
  // Node view
  // ---------------------------------------------------------------------------

  addNodeView() {
    return (props: NodeViewRendererProps) => {
      let currentNode = props.node

      const dom = document.createElement('div')
      dom.className = 'mermaid-block'
      dom.setAttribute('data-type', 'mermaid')
      dom.setAttribute('contenteditable', 'false')

      const svgWrap = document.createElement('div')
      svgWrap.className = 'mermaid-svg'

      const errorDiv = document.createElement('div')
      errorDiv.className = 'mermaid-error'
      errorDiv.style.display = 'none'

      dom.append(svgWrap, errorDiv)

      let lastCode = ''

      function showError(msg: string): void {
        svgWrap.innerHTML = ''
        errorDiv.textContent = `Diagram error: ${msg}`
        errorDiv.style.display = ''
      }

      async function render(code: string): Promise<void> {
        if (code === lastCode && svgWrap.innerHTML) return
        lastCode = code
        errorDiv.style.display = 'none'
        svgWrap.innerHTML = ''
        if (!code.trim()) return
        const result = await renderDiagram(code)
        // Guard against stale renders (node may have been destroyed or updated).
        if (code !== lastCode) return
        if ('error' in result) {
          showError(result.error)
        } else {
          // Sanitize mermaid's SVG output before injecting into the DOM.
          // mermaid's securityLevel:'strict' already sanitizes, but DOMPurify
          // is a second layer that prevents any SVG-based XSS if mermaid's
          // sanitizer is bypassed or misbehaves. Lazy-imported so it stays out
          // of the base bundle (it is only needed once a diagram renders).
          const { default: DOMPurify } = await import('dompurify')
          const clean = DOMPurify.sanitize(result.svg, {
            USE_PROFILES: { svg: true, svgFilters: true },
          })
          svgWrap.innerHTML = clean
          svgCache.set(code, clean)
          if (svgCache.size > 50) svgCache.delete(svgCache.keys().next().value as string)
          errorDiv.style.display = 'none'
        }
      }

      // Click: open the edit popover.
      dom.addEventListener('click', () => {
        const pos = (props.getPos as () => number | undefined)()
        if (pos == null) return
        globalOnClick?.(currentNode.attrs.code as string, pos)
      })

      // Initial render.
      void render(currentNode.attrs.code as string)

      return {
        dom,
        update(updated) {
          if (updated.type.name !== 'mermaid') return false
          currentNode = updated
          void render(updated.attrs.code as string)
          return true
        },
        ignoreMutation() {
          return true
        },
        stopEvent() {
          return false
        },
      }
    }
  },
})

/** Update the code attribute on a mermaid node at the given position. */
export function updateMermaidCode(
  editor: { state: { tr: import('@tiptap/pm/state').Transaction; doc: import('@tiptap/pm/model').Node }; view: { dispatch: (tr: import('@tiptap/pm/state').Transaction) => void } },
  pos: number,
  code: string,
): void {
  const node = editor.state.doc.nodeAt(pos)
  if (!node || node.type.name !== 'mermaid') return
  const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, code })
  editor.view.dispatch(tr)
}

/** Insert a new mermaid block at the current selection. */
export function insertMermaidBlock(
  editor: { chain: () => { focus: () => { insertContent: (c: unknown) => { run: () => void } } } },
  code = 'graph TD\n  A[Start] --> B[End]',
): void {
  editor.chain().focus().insertContent({ type: 'mermaid', attrs: { code } }).run()
}
