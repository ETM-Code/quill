// Lazy KaTeX. The engine (~260 KB of JS) and its stylesheet are fetched the
// first time a math node needs rendering, so documents without math never pay
// for them. Until then a math node shows its LaTeX source, and every pending
// element is upgraded in place once KaTeX arrives.
//
// vite.config.ts aliases the bare `katex` import inside
// @tiptap/extension-mathematics to ./katex-lazy.ts, which routes the node
// views' `katex.render()` calls through here.
import type { KatexOptions } from 'katex'

type KatexModule = { render: (latex: string, el: HTMLElement, options?: KatexOptions) => void }

let engine: KatexModule | null = null
let loading: Promise<void> | null = null
const pending = new Map<HTMLElement, { latex: string; options?: KatexOptions }>()

function flush(): void {
  if (!engine) return
  for (const [el, { latex, options }] of pending) {
    if (el.isConnected) {
      try {
        engine.render(latex, el, options)
        // The node views flag failures themselves; a late success clears nothing.
      } catch {
        el.textContent = latex
      }
    }
  }
  pending.clear()
}

/** Fetch KaTeX (JS + CSS) once; resolves after pending elements are upgraded. */
export function loadKatex(): Promise<void> {
  loading ??= Promise.all([import('katex/dist/katex.mjs'), import('katex/dist/katex.min.css')])
    .then(([mod]) => {
      engine = ((mod as { default?: KatexModule }).default ?? mod) as KatexModule
      flush()
    })
    .catch(err => {
      console.error('Failed to load KaTeX:', err)
      loading = null
    })
  return loading
}

/** Render into `el`: immediately when KaTeX is loaded, else LaTeX source now and the math later. */
export function renderMath(latex: string, el: HTMLElement, options?: KatexOptions): void {
  if (engine) {
    pending.delete(el)
    engine.render(latex, el, options)
    return
  }
  el.textContent = latex
  pending.set(el, { latex, options })
  void loadKatex()
}

/** Resolves once nothing is waiting on KaTeX (print waits on this). */
export async function whenMathReady(): Promise<void> {
  if (pending.size === 0) return
  await loadKatex()
}

export function katexLoaded(): boolean {
  return engine !== null
}
