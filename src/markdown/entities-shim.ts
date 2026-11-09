// Production stand-in for the `entities` package inside markdown-it (wired by
// the plugin in vite.config.ts). markdown-it only calls decodeHTML on a single
// "&name;" / "&#123;" candidate; the browser's own HTML parser decodes it the
// same way, which saves the ~21 KB (gzip) named-entity table.
let decoder: HTMLTextAreaElement | null = null
const cache = new Map<string, string>()

export function decodeHTML(str: string): string {
  let out = cache.get(str)
  if (out !== undefined) return out
  decoder ??= document.createElement('textarea')
  // A <textarea> parses its content as text: entities decode, tags don't.
  decoder.innerHTML = str
  out = decoder.value
  if (cache.size < 2000) cache.set(str, out)
  return out
}
