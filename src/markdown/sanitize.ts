// Display-only sanitising for raw HTML kept in the document. The original
// HTML is never modified; only what the editor shows goes through DOMPurify.
// DOMPurify loads lazily (most documents have no raw HTML); until it arrives
// callers show the source text.
import type { DOMPurify as Purifier } from 'dompurify'
import { resolveForDisplay } from '../images'

let purify: Purifier | null = null
let loading: Promise<Purifier> | null = null

function setup(p: Purifier): Purifier {
  // Local images in raw HTML (<img src="assets/x.png" width=200>) resolve
  // like markdown images do.
  p.addHook('afterSanitizeAttributes', node => {
    if (node.tagName === 'IMG') {
      const src = node.getAttribute('src')
      if (src) node.setAttribute('src', resolveForDisplay(src))
    }
    if (node.tagName === 'A') node.setAttribute('tabindex', '-1')
  })
  return p
}

export function loadSanitizer(): Promise<Purifier> {
  loading ??= import('dompurify').then(m => (purify = setup(m.default)))
  return loading
}

const CONFIG = {
  FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed'],
  FORBID_ATTR: ['style'],
}

/** Sanitised HTML, or null while DOMPurify is still loading. */
export function sanitizeHtmlSync(html: string): string | null {
  if (!purify) {
    void loadSanitizer()
    return null
  }
  return purify.sanitize(html, CONFIG) as string
}

export async function sanitizeHtml(html: string): Promise<string> {
  const p = purify ?? (await loadSanitizer())
  return p.sanitize(html, CONFIG) as string
}

/** Text of an HTML snippet without rendering it (tags dropped). */
export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return doc.body.textContent ?? ''
}
