# Size and speed work (branch improve/speed-size-markdown)

What changed, and what was looked at and left alone. Numbers are from `harness/perf-startup.ts`,
`harness/perf-open.ts` (WebKit, mocked Tauri, production build) and `harness/launch-timing-headless.py`
(real app); timings are medians on a loaded machine, so small deltas are noise.

## Adopted
- **KaTeX fonts: woff2 only.** `katexWoff2Only` in `vite.config.ts` strips the woff/ttf `src` entries from
  katex.min.css. WKWebView only ever loads woff2. dist brotli -590 KB.
- **Lazy KaTeX (JS + CSS).** `@tiptap/extension-mathematics` imports `katex` statically, so `katexLazy` in
  `vite.config.ts` points that one import at `src/katex-lazy.ts`. Math nodes render their LaTeX source at once and
  are typeset in place when `src/math-render.ts` has loaded the engine; documents without math never fetch it.
  Print awaits `whenMathReady()`. Copy-out HTML and plain text are built from node attrs (LaTeX source), so they
  never depended on typeset DOM. Checked by `harness/verify-lazy.ts` against the production build.
- **Mermaid** loads only for a document with a diagram, or when its popover is used (the eager `loadMermaid()`
  in the popover constructor is gone). Math and Mermaid popovers are built on first use.
- **Code-block language `<select>`** holds only its selected option until focus/mousedown; label widths are cached.
- **Rust:** `opt-level = "z"`, no startup sleep around `RunEvent::Ready` (a file that arrives via `Opened` just
  after launch replaces the blank startup window), removed `tauri-plugin-deep-link`, the dead
  `register_frontend_ready` command and its state, `withGlobalTauri`.
- **Icons:** `icon.icns` PNGs recompressed with zopfli (pixel-identical, checked per entry). `document.icns` was
  already tight (-4 bytes). Lossless gives about -10%; going further needs palette quantisation (lossy).

## Not adopted
- **Keepalive webview replacement** (`ExitRequested` + `prevent_exit`). Needs closing the last window, Dock
  reopen and Dock quit exercised in the real app, which this environment could not do (display asleep: no window is
  ever on screen, no key events). Dock Quit and "last window closed" both arrive as `ExitRequested { code: None }`,
  so a replacement must tell them apart (e.g. time since the last window was destroyed). Left as is.
- Mermaid diagram-type stubbing (product call), `content-visibility` (typing and scroll are at the frame floor).
