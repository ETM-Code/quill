<p align="center">
  <img src="quill.svg" alt="Quill logo" width="180" />
</p>

<p align="center">
  <img src="screenshot.png" alt="Quill" width="700" />
</p>

<h1 align="center">Quill</h1>

<p align="center">
  A fast, native markdown editor for macOS, Windows, and Linux.<br/>
  WYSIWYG editing with LaTeX math and syntax highlighting.
</p>

<p align="center">
  <a href="#install">Install</a> &middot;
  <a href="#features">Features</a> &middot;
  <a href="#benchmarks">Benchmarks</a> &middot;
  <a href="#development">Development</a>
</p>

---

## Install

Download the latest release for your platform from [Releases](https://github.com/ETM-Code/quill/releases), or build from source:

```bash
bun install
bun run tauri build
```

Built installers will be in `src-tauri/target/release/bundle/` (for example: `.dmg` on macOS, `.msi`/`.nsis` on Windows, `.deb`/`.AppImage` on Linux).

## Features

- **WYSIWYG markdown** — Write in rich text, save as `.md`. Headings, bold, italic, lists, blockquotes, code, links.
- **Images** — Render and round-trip standard Markdown images. Insert by URL or file path from the block menu.
- **LaTeX math** — Inline `$E=mc^2$` and block `$$...$$` equations rendered live via KaTeX.
- **Syntax highlighting** — Code blocks with language detection. Lazy-loaded so it doesn't slow down launch.
- **Light & dark mode** — Follows your system appearance automatically.
- **Native desktop** — macOS uses an overlay titlebar; Windows/Linux use native titlebars. File associations for `.md`, `.markdown`, `.txt`.
- **Open Recent** — Reopen recently used documents from `File > Open Recent` (persisted between launches).
- **Tiny footprint** — 11 MB app bundle, 4.6 MB DMG. Half the size of MacDown.

## Benchmarks

Time from `open -a <App>.app` to window visible, averaged over 5 runs (Apple M3, macOS 26.2):

| Test | Quill | MacDown |
|------|------:|--------:|
| Empty launch | **640ms** | 856ms |
| Open 720B note | **567ms** | 765ms |
| Open 14KB document | **509ms** | 679ms |
| Open 214KB document | **550ms** | 798ms |

Quill wins every launch/open scenario in this run.

Methodology note: these runs were interleaved (Quill, then MacDown, repeat) while my Mac was busy doing normal work with a dozen other apps/tabs/processes open. Absolute times should improve on an idle machine, but real-world loaded behavior is the benchmark that matters most.

**Size comparison:**

| | Quill | MacDown |
|---|---:|---:|
| App bundle | **11 MB** | 22 MB |
| DMG | **4.6 MB** | — |

## How it works

Quill is a [Tauri 2](https://tauri.app) app. The backend is Rust; the frontend runs in the system WebKit view (no bundled browser engine). The editor is [Tiptap](https://tiptap.dev) (ProseMirror) with the [Markdown extension](https://tiptap.dev/docs/extensions/markdown) for round-trip `.md` serialization.

**Key design choices:**

- **Lazy-loaded code highlighting** — [lowlight](https://github.com/wooorm/lowlight) (45KB gzipped) is only loaded when you type your first code fence. This keeps the initial bundle fast.
- **Guarded math migration** — The `$...$` to KaTeX node conversion only runs when a transaction actually contains dollar signs, avoiding expensive DOM walks on every keystroke.
- **Window URL params** — Files opened via OS file association are passed to the frontend through URL query params, avoiding race conditions with Tauri's IPC bridge.
- **Keepalive window (macOS)** — A hidden window keeps the process alive on macOS when all editor windows are closed, so re-opening is instant.

```
quill/
├── src/                     # Frontend (TypeScript)
│   ├── main.ts              # Editor setup, file I/O, keyboard shortcuts
│   ├── math-migration.ts    # $...$ and $$...$$ to KaTeX node conversion
│   ├── editor-markdown.ts   # Markdown get/set abstraction
│   ├── startup-files.ts     # File association handling
│   └── styles.css           # Theming, typography
├── src-tauri/               # Backend (Rust)
│   ├── src/lib.rs           # Window management, file associations, IPC
│   └── tauri.conf.json      # App config, file associations, bundling
└── index.html
```

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+S` | Save |
| `Cmd/Ctrl+O` | Open |
| `Cmd/Ctrl+N` | New |
| `# ` | Heading (1-6 levels) |
| `- ` | Bullet list |
| `1. ` | Ordered list |
| `> ` | Blockquote |
| ` ``` ` | Code block |
| `$...$` | Inline math |
| `$$...$$` | Block math |

## Development

```bash
bun install        # Install dependencies
bun run tauri dev  # Dev server with hot reload
bun run tauri build # Production build
```

**Requirements:** [Bun](https://bun.sh), [Rust](https://rustup.rs), plus platform build deps:
- macOS: Xcode Command Line Tools
- Linux: `webkit2gtk` + `libgtk-3` development packages
- Windows: WebView2 runtime (usually already present on Windows 11)

**Tests:**

```bash
bun test           # Frontend unit tests
bun run test:smoke:open  # Startup file-open smoke test
bun run test:size  # Build + JS/CSS size budget check
bun run test:perf:startup # Build + startup performance budget check
bun run test:perf:paint # Build + first contentful paint + markdown render timing
cd src-tauri && cargo test  # Backend tests
```

## License

MIT
