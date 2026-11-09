// Display-only sanitising for raw HTML kept in the document. The original
// HTML is never modified; only what the editor shows goes through DOMPurify.
import DOMPurify from 'dompurify'
import { resolveForDisplay } from '../images'

let hooked = false

export function sanitizeHtml(html: string): string {
  if (!hooked) {
    hooked = true
    // Local images in raw HTML (<img src="assets/x.png" width=200>) resolve
    // like markdown images do.
    DOMPurify.addHook('afterSanitizeAttributes', node => {
      if (node.tagName === 'IMG') {
        const src = node.getAttribute('src')
        if (src) node.setAttribute('src', resolveForDisplay(src))
      }
      if (node.tagName === 'A') node.setAttribute('tabindex', '-1')
    })
  }
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['style'],
  })
}
