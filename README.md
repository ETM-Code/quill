<p align="center">
  <img src="screenshot.png" alt="Quill" width="700" />
</p>

<h1 align="center">Quill</h1>

<p align="center">
  Open any markdown file instantly as a real document.<br/>
  Notion-style WYSIWYG editing with LaTeX math, Mermaid diagrams, tables, and a ~5.5 MB download.
</p>

<p align="center">
  Most of what LLMs produce is markdown, but there's no nice local way to open a lone <code>.md</code>
  as a document instead of source. Obsidian wants a vault and a slow boot; MacDown shows source plus a
  preview, not WYSIWYG. Quill is the missing opener: double-click a markdown file and it renders
  instantly as an editable document. No vault, no Electron.
</p>

<p align="center">
  <a href="#install">Install</a> &middot;
  <a href="#features">Features</a> &middot;
  <a href="#how-quill-compares">Compare</a> &middot;
  <a href="#performance">Performance</a> &middot;
  <a href="#development">Development</a>
</p>

---

## Install

Quill is a native macOS app. Grab the latest `.dmg` from
[Releases](https://github.com/ETM-Code/quill/releases) — `Quill_x.y.z_aarch64.dmg` for Apple Silicon
(M1 and later) or `Quill_x.y.z_x64.dmg` for Intel — open it, and drag **Quill** into Applications.

> **Not on a Mac?** The sibling
> [**Quill for VS Code**](https://marketplace.visualstudio.com/items?itemName=etm-code.quill-vscode)
> extension runs the same editor in VS Code on any platform. Install *Quill Markdown Editor*
> (`etm-code.quill-vscode`) from the Marketplace, or grab a `.vsix` from
> [its releases](https://github.com/ETM-Code/quill-vscode/releases).

### First launch

Quill is ad-hoc signed but not notarized (notarizing needs a $99/yr Apple Developer account, and Quill
is a free side project), so macOS Gatekeeper blocks the first launch of a download. Clear it once:

```bash
xattr -cr /Applications/Quill.app
```

That removes the `com.apple.quarantine` flag and Quill opens normally from then on. No terminal? Open
Quill, let macOS block it, then go to **System Settings → Privacy & Security → Open Anyway**. Or skip
the unsigned binary entirely and build from source — a local build is never quarantined.

### Build from source

```bash
bun install
bun run tauri build
```

The `.app` and `.dmg` land in `src-tauri/target/release/bundle/`. Requires [Bun](https://bun.sh),
[Rust](https://rustup.rs), and Xcode Command Line Tools.

## Features

**Writing**

- **WYSIWYG markdown** — Write in rich text, save as plain `.md`. Headings, bold, italic, underline, strikethrough, lists, blockquotes, code, links.
- **Tables** — GFM tables render and edit inline; row/column controls appear in the toolbar when the caret is inside one.
- **Task lists** — `- [ ]` checkboxes, clickable, round-trip faithfully.
- **LaTeX math** — Inline `$E=mc^2$` and block `$$...$$` via KaTeX. Click an equation to edit it in a popover with live preview.
- **Mermaid diagrams** — A fenced `mermaid` code block renders as a diagram (or insert one with `/`); click it to edit in a popover with live preview.
- **Code blocks** — Syntax highlighting with a language picker and one-click copy. Grammars load lazily per language, so they cost nothing until used.
- **Images** — Paste, drop, or insert. Files are saved into an `assets/` folder beside the document and linked relatively; local and remote images render inline. (Saved documents only.)

**Editing UX**

- **Formatting toolbar** — Select text and a Notion-style bubble menu appears: turn-into dropdown, marks, link.
- **Slash commands** — Type `/` on an empty line to insert any block: headings, lists, tables, math, diagrams, dividers, code.
- **Links that work** — Click for a popover (open / edit / remove), ⌘-click to open, ⌘K to create one from a selection. Pasted URLs onto selections become links.
- **Find & replace** — ⌘F to find, ⌘⌥F to replace, with live match highlighting.
- **Markdown clipboard** — Copy puts markdown on the clipboard; pasting markdown text recreates rich blocks.

**App behavior**

- **Native menu bar** — File / Edit / Window menus with Open Recent and all standard shortcuts.
- **Unsaved-changes guards** — Closing a dirty window or quitting with unsaved work asks first.
- **Crash-safe drafts** — Unsaved work is checkpointed every couple of seconds; on relaunch Quill offers to restore it.
- **Light & dark mode** — Follows the system appearance.
- **Native macOS** — Overlay titlebar, file associations for `.md`, `.markdown`, `.txt`, word count in the titlebar.
- **Tiny footprint** — ~7 MB app bundle, ~5.5 MB DMG.

## How Quill compares

Quill lives in a narrow gap: open a *single* `.md` file instantly, edit it as a real WYSIWYG document, and stay tiny and free. Plenty of tools overlap on one axis; almost none hit all of them at once.

| Tool | WYSIWYG | Opens a lone file instantly | Footprint | Open source | Price |
|---|---|---|---|---|---|
| **Quill** | Yes, block-style | Yes (the whole point) | ~7 MB (Tauri + system WebKit) | Yes (MIT) | Free |
| **Typora** | Yes, true inline | Yes | ~100 MB+ (Electron) | No | $14.99 |
| **MarkText** | Yes | Yes | ~100 MB+ (Electron) | Yes | Free |
| **Obsidian** | Yes (Live Preview) | No, vault-first | ~100 MB+ (Electron) | No | Free, paid sync |
| **iA Writer** | Styled source, not blocks | Yes | Native, light | No | ~$30 |
| **MacDown** | No, source + preview | Yes | Native, light | Yes | Free |
| **Bear / Craft** | Yes | No, own library | Native | No | Subscription |

**Typora** is the only true head-to-head competitor, and it's more featureful: export to PDF / Word / HTML via Pandoc, a large theme ecosystem, and Windows and Linux builds. Quill's trade is the opposite: open source, native, free, and a fraction of the size (~5.5 MB against Electron's ~100 MB). Want the kitchen sink? Use Typora. Want a fast, free, lone-file opener that renders instantly? That's Quill. **MarkText** is the closest free analog but ships Electron and is lightly maintained. Everything else makes you adopt a vault or library (Obsidian, Bear, Craft), shows source instead of a rendered document (MacDown), or styles the source rather than editing in blocks (iA Writer).

## Performance

Measured on an Apple M3 (release build, `harness/smoke-macos.sh`; timings include `open(1)` and polling overhead, so true figures are slightly better):

| Scenario | Time |
|---|---:|
| Warm launch → window visible | ~0.8–0.9 s |
| Open a 14 KB document into the running app | ~0.4–0.6 s |
| Open a 209 KB document into the running app | ~0.6–0.9 s |
| Reopen after closing last window (keepalive) | ~0.3 s |

The 209 KB case used to take 2.3 s+: marked's lexer is quadratic in input size, so Quill splits large documents at safe top-level boundaries (never inside fences, lists, quotes, or tables, verified byte-identical against whole-document parsing) and parses each chunk independently. 209 KB now parses in ~450 ms instead of 5.7 s.

## How it works

Quill is a [Tauri 2](https://tauri.app) app: Rust backend, frontend in the system WebKit view (no bundled browser engine). The editor is [Tiptap](https://tiptap.dev) (ProseMirror) with the [Markdown extension](https://tiptap.dev/docs/extensions/markdown) for round-trip `.md` serialization.

**Key design choices:**

- **One editor instance for the window's lifetime** — syntax-highlight grammars register into the live lowlight instance per language on demand (each its own ~1–8 KB chunk) rather than recreating the editor, so undo history survives.
- **Chunked markdown parsing** — sidesteps marked's quadratic lexer on large files (see Performance).
- **Markdown-native math** — `$...$` is parsed by the Mathematics extension's own tokenizer during parsing; no post-parse rewriting.
- **Blank keepalive window** — a hidden, JS-free page keeps the process alive after the last editor window closes, so reopening is ~0.3 s.
- **Custom Quit menu item** — the predefined one sends `terminate:` directly, bypassing Tauri's exit events and skipping the unsaved-changes guard.
- **Window URL params** — files opened via file association pass through URL query params, avoiding IPC races at startup.

```
quill/
├── src/                    # Frontend (TypeScript, no framework)
│   ├── main.ts             # Boot, wiring, shortcuts, menu events
│   ├── editor-setup.ts     # Tiptap extensions, lazy grammars, chunked parse, clipboard
│   ├── file-ops.ts         # Open/save/dirty/recents/drafts/close guard
│   ├── images.ts           # Image paste/drop, assets/ writes, markdown round-trip
│   ├── mermaid.ts          # Mermaid diagram node + lazy renderer
│   └── ui/                 # Bubble menu, slash menu, popovers, find bar, toasts
├── src-tauri/              # Backend (Rust)
│   ├── src/lib.rs          # Windows, native menu, quit guard, file associations
│   └── tauri.conf.json
├── harness/                # Test harness (see Development)
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
bun harness/features.ts     # End-to-end UI flows in real WebKit (Playwright + Tauri IPC mock)
bun harness/audit.ts        # Round-trip fidelity + rendering audit
bash harness/smoke-macos.sh # Packaged-app smoke test: launch, file assoc, keepalive, quit
cd src-tauri && cargo test  # Backend tests
```

The harness runs the real frontend in Playwright WebKit with the Tauri IPC layer mocked (`harness/tauri-mock.js`), so dialogs, saves, and the opener are scriptable. The smoke test drives the actual packaged `.app`.

## License

MIT
</content>
