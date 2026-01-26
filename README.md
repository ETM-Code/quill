# Quill

A fast, minimal markdown editor for macOS built with Tauri and Tiptap.

## Features

- **Instant launch** — Tauri + system WebKit means sub-500ms cold start
- **Low memory** — ~30-50MB idle vs 200MB+ for Electron apps
- **Full markdown** — Headings, bold, italic, lists, blockquotes, code, links
- **LaTeX math** — Inline `$E=mc^2$` and block `$$...$$` equations via KaTeX
- **Syntax highlighting** — Code blocks with language detection (lazy-loaded)
- **Light/dark mode** — Automatic system theme matching
- **Native feel** — macOS overlay titlebar with traffic lights

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Save | `Cmd+S` |
| Open | `Cmd+O` |
| New | `Cmd+N` |
| Bold | `Cmd+B` |
| Italic | `Cmd+I` |
| Code | `Cmd+E` |

Markdown shortcuts work inline: `# ` for headings, `- ` for lists, `> ` for quotes, ``` for code blocks.

## Math

Type LaTeX between dollar signs:

- Inline: `$\sum_{i=1}^n x_i$`
- Block: `$$\int_0^\infty e^{-x^2} dx$$`

Close with `$` to render.

## Development

```bash
# Install dependencies
bun install

# Run dev server
bun run tauri dev

# Build for production
bun run tauri build
```

Requires:
- [Bun](https://bun.sh)
- [Rust](https://rustup.rs)
- Xcode Command Line Tools (macOS)

## Architecture

```
quill/
├── src/                 # Frontend (TypeScript)
│   ├── main.ts          # Editor setup, file I/O
│   └── styles.css       # Theming, typography
├── src-tauri/           # Backend (Rust)
│   ├── src/lib.rs       # Tauri plugins
│   └── tauri.conf.json  # Window config
└── index.html
```

**Stack:**
- [Tauri 2.0](https://tauri.app) — Native wrapper using system WebView
- [Tiptap](https://tiptap.dev) — ProseMirror-based editor
- [KaTeX](https://katex.org) — Math rendering
- [lowlight](https://github.com/wooorm/lowlight) — Syntax highlighting

## Bundle Size

| Component | Size (gzip) |
|-----------|-------------|
| Core editor | ~210KB |
| Code highlighting | ~130KB (lazy) |
| KaTeX CSS + fonts | ~10KB |

Total initial load: ~220KB gzipped.

## License

MIT
