// Extends harness/tauri-mock.js (injected before it) for the UX scenarios:
// records event listeners so tests can fire native events (drag-drop, menu),
// and answers the app commands added for links/images/print.
(() => {
  const mock = window.__QUILL_MOCK__
  const base = window.__TAURI_INTERNALS__.invoke
  mock.listeners = [] // { event, handler }
  mock.uxCalls = []
  // Local images render as a generated picture so they have real size.
  let picture = null
  window.__TAURI_INTERNALS__.convertFileSrc = (p) => {
    if (!/\.(png|jpe?g|gif|webp)$/i.test(p)) return p
    if (!picture) {
      const c = document.createElement('canvas')
      c.width = 320; c.height = 200
      const g = c.getContext('2d')
      const grad = g.createLinearGradient(0, 0, 320, 200)
      grad.addColorStop(0, '#5b8def'); grad.addColorStop(1, '#a55bef')
      g.fillStyle = grad; g.fillRect(0, 0, 320, 200)
      picture = c.toDataURL('image/png')
    }
    return picture
  }
  mock.dirs = new Set(['/mock/doc', '/mock/doc/assets', '/mock/other'])
  window.__QUILL_EMIT__ = (event, payload) => {
    let n = 0
    for (const l of mock.listeners) {
      if (l.event !== event) continue
      const fn = window[`_${l.handler}`]
      if (typeof fn === 'function') { fn({ event, id: l.handler, payload }); n++ }
    }
    return n
  }
  window.__TAURI_INTERNALS__.invoke = async (cmd, args, options) => {
    switch (cmd) {
      case 'plugin:event|listen':
        mock.calls.push({ cmd, args })
        mock.listeners.push({ event: args.event, handler: args.handler })
        return args.handler
      case 'open_markdown_window':
      case 'open_local_path':
      case 'reveal_local_path':
      case 'print_window':
      case 'set_window_path': {
        mock.calls.push({ cmd, args })
        mock.uxCalls.push({ cmd, args })
        if ((cmd === 'open_local_path' || cmd === 'open_markdown_window') && !mock.files.has(args.path) && !mock.dirs.has(args.path)) {
          throw `File not found: ${args.path}`
        }
        if (cmd === 'open_local_path' && /\.(app|sh|command)$/.test(args.path) && !args.confirmed) throw 'needs-confirmation'
        return null
      }
      case 'import_asset': {
        mock.calls.push({ cmd, args })
        mock.uxCalls.push({ cmd, args })
        const name = args.source.split('/').pop()
        mock.files.set(`${args.docDir}/assets/${name}`, '<image-bytes>')
        return `assets/${name}`
      }
      case 'plugin:path|resolve_directory':
        return '/mock/home'
    }
    return base(cmd, args, options)
  }
})()
