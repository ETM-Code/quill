// Tauri IPC mock injected into the page before any app code runs.
// Faithful to the invoke() shapes used by @tauri-apps/api v2 and the
// dialog/fs/opener plugins (see harness/README.md for the captured shapes).
//
// Configure via window.__QUILL_MOCK_SEED__ (injected by the driver):
//   { files: { "/path": "content" }, dialog: { save, open, ask, confirm } }
//
// Inspect from tests via window.__QUILL_MOCK__:
//   .files            Map<path, content> (written files land here)
//   .calls            [{ cmd, args }] every invoke
//   .openedUrls       URLs passed to plugin:opener|open_url
//   .dialog           mutable dialog responses

(() => {
  const seed = window.__QUILL_MOCK_SEED__ || {}
  const files = new Map(Object.entries(seed.files || {}))
  const mock = {
    files,
    calls: [],
    openedUrls: [],
    revealedPaths: [],
    dialog: Object.assign({ save: null, open: null, ask: true, confirm: true }, seed.dialog),
    windowVisible: false,
    windowTitle: null,
    documentEdited: null,
  }
  window.__QUILL_MOCK__ = mock

  let callbackId = 0
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  window.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: 'main' },
      currentWebview: { label: 'main', windowLabel: 'main' },
      windows: [{ label: 'main' }],
      webviews: [{ label: 'main', windowLabel: 'main' }],
    },
    plugins: {},
    convertFileSrc: (p) => p,
    transformCallback: (callback, once) => {
      const id = ++callbackId
      const prop = `_${id}`
      Object.defineProperty(window, prop, {
        value: (result) => {
          if (once) Reflect.deleteProperty(window, prop)
          return callback && callback(result)
        },
        writable: false,
        configurable: true,
      })
      return id
    },
    unregisterCallback: (id) => {
      Reflect.deleteProperty(window, `_${id}`)
    },
    invoke: async (cmd, args, options) => {
      mock.calls.push({ cmd, args: args instanceof Uint8Array ? '<bytes>' : args })

      switch (cmd) {
        // --- fs plugin ---
        case 'plugin:fs|read_text_file': {
          const path = args.path
          if (!files.has(path)) throw `failed to read ${path}: mock: no such file`
          return encoder.encode(files.get(path))
        }
        case 'plugin:fs|write_text_file': {
          const path = decodeURIComponent(options.headers.path)
          files.set(path, decoder.decode(args))
          return null
        }
        case 'plugin:fs|exists':
          return files.has(args.path)

        // --- dialog plugin ---
        case 'plugin:dialog|save':
          return mock.dialog.save
        case 'plugin:dialog|open':
          return mock.dialog.open
        case 'plugin:dialog|ask':
          return mock.dialog.ask
        case 'plugin:dialog|confirm':
          return mock.dialog.confirm
        case 'plugin:dialog|message':
          return null

        // --- opener plugin ---
        case 'plugin:opener|open_url':
          mock.openedUrls.push(args.url)
          return null
        case 'plugin:opener|open_path':
          mock.openedUrls.push(args.path)
          return null
        case 'plugin:opener|reveal_item_in_dir':
          mock.revealedPaths.push(args.paths)
          return null

        // --- window plugin ---
        case 'plugin:window|show':
          mock.windowVisible = true
          return null
        case 'plugin:window|hide':
          mock.windowVisible = false
          return null
        case 'plugin:window|set_title':
          mock.windowTitle = args.value
          return null
        case 'plugin:window|set_document_edited':
          mock.documentEdited = args.value
          return null

        // --- event plugin ---
        case 'plugin:event|listen':
          return ++callbackId
        case 'plugin:event|unlisten':
          return null
        case 'plugin:event|emit':
        case 'plugin:event|emit_to':
          return null

        // --- app commands ---
        case 'read_markdown_file': {
          const path = args.path
          if (!files.has(path)) throw `failed to read ${path}: mock: no such file`
          return files.get(path)
        }
        case 'register_frontend_ready':
          return []
        case 'write_image_file':
          // Record the written path so tests can assert; bytes arrive as number[].
          files.set(args.path, '<image-bytes>')
          return null

        default:
          console.warn('[tauri-mock] unhandled invoke:', cmd, args)
          return null
      }
    },
  }
})()
