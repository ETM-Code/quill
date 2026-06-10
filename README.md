<p align="center">
  <img src="screenshot.png" alt="Quill" width="700" />
</p>

<h1 align="center">Quill</h1>

<p align="center">
  A fast, native markdown editor for macOS.<br/>
  Notion-style WYSIWYG editing with LaTeX math, tables, task lists, and a ~4.5 MB download.
</p>

<p align="center">
  <a href="#install">Install</a> &middot;
  <a href="#features">Features</a> &middot;
  <a href="#performance">Performance</a> &middot;
  <a href="#development">Development</a>
</p>

---

## Install

Download the latest `.dmg` from [Releases](https://github.com/ETM-Code/quill/releases), or build from source:

```bash
bun install
bun run tauri build
```

The `.app` bundle and `.dmg` installer will be in `src-tauri/target/release/bundle/`.

## Features

**Writing**

- **WYSIWYG markdown** — Write in rich text, save as plain `.md`. Headings, bold, italic, underline, strikethrough, lists, blockquotes, code, links.
- **Tables** — GFM tables render and edit inline; row/column controls appear in the toolbar when the caret is inside one.
- **Task lists** — `- [ ]` checkboxes, clickable, round-trip faithfully.
- **LaTeX math** — Inline `$E=mc^2$` and block `$$...$$` via KaTeX. Click any equation to edit it in a popover with live preview.
- **Code blocks** — Syntax highlighting with a language picker and one-click copy. Grammars load lazily per language, so they cost nothing until used.

**Editing UX**

- **Formatting toolbar** — Select text and a Notion-style bubble menu appears: turn-into dropdown, marks, link.
- **Slash commands** — Type `/` on an empty line to insert any block: headings, lists, tables, math, dividers, code.
- **Links that work** — Click a link for a popover (open / edit / remove), ⌘-click to open directly, ⌘K to create one from a selection. Pasted URLs onto selections become links.
- **Find & replace** — ⌘F to find, ⌘⌥F to replace, with live match highlighting.
- **Markdown clipboard** — Copying puts markdown on the clipboard (paste structure into any app); pasting markdown text recreates rich blocks.

**App behavior**

- **Native menu bar** — File / Edit / Window menus with Open Recent, all standard shortcuts.
- **Unsaved-changes guards** — Closing a dirty window asks to save; quitting with dirty documents asks first.
- **Crash-safe drafts** — Unsaved work is checkpointed locally every couple of seconds; on relaunch Quill offers to restore it.
- **Light & dark mode** — Follows the system appearance automatically.
- **Native macOS** — Overlay titlebar with traffic lights, file associations for `.md`, `.markdown`, `.txt`, word count in the titlebar.
- **Tiny footprint** — ~11 MB app bundle, ~4.5 MB DMG.

## Performance

Measured on an Apple M3 (release build, `harness/smoke-macos.sh`; timings include
`open(1)` and polling overhead, so true figures are slightly better):

| Scenario | Time |
|---|---:|
| Warm launch → window visible | ~0.8–0.9 s |
| Open a 14 KB document into the running app | ~0.4–0.6 s |
| Open a 209 KB document into the running app | ~0.6–0.9 s |
| Reopen after closing last window (keepalive) | ~0.3 s |

The 209 KB case used to take 2.3 s+: marked's lexer is quadratic in input size,
so Quill now splits large documents into parse-safe chunks (never inside fences,
lists, quotes, or tables — verified byte-identical against whole-document
parsing) and parses each independently. 209 KB parses in ~450 ms instead of 5.7 s.

## How it works

Quill is a [Tauri 2](https://tauri.app) app. The backend is Rust; the frontend runs in the system WebKit view (no bundled browser engine). The editor is [Tiptap](https://tiptap.dev) (ProseMirror) with the [Markdown extension](https://tiptap.dev/docs/extensions/markdown) for round-trip `.md` serialization.

**Key design choices:**

- **One editor instance for the window's lifetime** — syntax-highlight grammars are registered into the live lowlight instance per language on demand (each is its own ~1–8 KB chunk), instead of recreating the editor, so undo history survives.
- **Chunked markdown parsing** — sidesteps marked's quadratic lexer on large files (see Performance).
- **Markdown-native math** — `$...$` is parsed by the Mathematics extension's own tokenizer during markdown parsing; no post-parse document rewriting.
- **Blank keepalive window** — a hidden, JS-free page keeps the process alive on macOS after the last editor window closes, so reopening is ~0.3 s.
- **Custom Quit menu item** — the predefined one sends `terminate:` directly, bypassing Tauri's exit events, which would skip the unsaved-changes guard.
- **Window URL params** — files opened via macOS file association are passed through URL query params, avoiding IPC races at startup.

```
quill/
├── src/                       # Frontend (TypeScript, no framework)
│   ├── main.ts                # Boot, wiring, shortcuts, menu events
│   ├── editor-setup.ts        # Tiptap extensions, lazy grammars, chunked parse, clipboard
│   ├── file-ops.ts            # Open/save/dirty/recents/drafts/close guard
│   ├── icons.ts               # Inline SVG icon set
│   └── ui/                    # Bubble menu, slash menu, popovers, find bar, toasts
├── src-tauri/                 # Backend (Rust)
│   ├── src/lib.rs             # Windows, native menu, quit guard, file associations
│   └── tauri.conf.json
├── harness/                   # Test harness (see Development)
└── index.html
```

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘S` / `⇧⌘S` | Save / Save As |
| `⌘O` | Open |
| `⌘N` / `⇧⌘N` | New / New Window |
| `⌘F` / `⌥⌘F` | Find / Find & Replace |
| `⌘K` | Add or edit link on selection |
| `⌘B` `⌘I` `⌘U` `⌘E` | Bold, italic, underline, inline code |
| `⌘Z` / `⇧⌘Z` | Undo / Redo |
| `/` | Slash command menu (on empty line) |
| `# ` `- ` `1. ` `> ` | Heading, bullet, numbered, quote |
| ``` ``` ``` | Code block |
| `$...$` / `$$...$$` | Inline / block math |

## Development

```bash
bun install         # Install dependencies
bun run tauri dev   # Dev server with hot reload
bun run tauri build # Production build
```

**Requirements:** [Bun](https://bun.sh), [Rust](https://rustup.rs), Xcode Command Line Tools.

**Tests:**

```bash
bun test                    # Unit tests (markdown chunking, startup files)
bun harness/features.ts     # 66 end-to-end UI flows in real WebKit (Playwright + Tauri IPC mock)
bun harness/audit.ts        # Round-trip fidelity + rendering audit
bun run build && bun harness/perf.ts   # Performance measurements vs the production build
bash harness/smoke-macos.sh # Packaged-app smoke test: launch, file assoc, keepalive, quit
cd src-tauri && cargo test  # Backend tests
```

The harness runs the real frontend in Playwright WebKit with the Tauri IPC layer mocked (`harness/tauri-mock.js`), so file dialogs, saves, and the opener plugin are observable and scriptable. The smoke test drives the actual packaged `.app`.

## License

MIT
