<p align="center">
  <img src="screenshot.png" alt="Quill" width="700" />
</p>

<h1 align="center">Quill</h1>

<p align="center">
  Open any markdown file instantly as a real document.<br/>
  Notion-style WYSIWYG editing with LaTeX math, Mermaid diagrams, tables, and a ~5.5 MB download.
</p>

<p align="center">
  Most of what LLMs produce is markdown, and in 2026 opening a lone <code>.md</code> as a real document
  (not raw source) turned into a small rush of tools. Quill's cut: native, block-style WYSIWYG, fully
  open source down to the editor, a few megabytes, and also a VS Code extension. Double-click a markdown
  file and it renders instantly as an editable document. No vault, no Electron.
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

Opening a lone `.md` as a real document instead of raw source went from a gap to a crowd in 2026 — a dozen-odd tools now do some version of it. They sort into camps:

- **Instant native WYSIWYG openers** — double-click, edit it rendered, stay small: Quill, [MarkViewer](https://markviewer.com), [DOMD](https://github.com/do-md/domd).
- **Render-only surfaces** — show it, don't edit it: [MacMD Viewer](https://macmdviewer.com), Finder's own Quick Look.
- **Agent-facing tools** — built to render what an AI writes: [SmallDocs](https://github.com/espressoplease/SDocs) (`sdoc`, a CLI), DOMD's streaming CLI, MacMD's file-watching.
- **Cross-platform Rust entrants** — [Ferrite](https://getferrite.dev) (egui) and [Inkwell](https://inkwell.4worlds.dev) (Tauri), more split/preview than pure inline.
- **The heavyweights** — [Obsidian](https://obsidian.md), [Typora](https://typora.io), [iA Writer](https://ia.net/writer), and [MarkText](https://github.com/marktext/marktext) (Electron, 57k★, and despite the rumor still actively maintained).

**The 2026 lightweight wave:**

| Tool | Editing | Tech / size | Open source | Price | Angle |
|---|---|---|---|---|---|
| **Quill** | Block WYSIWYG | Tauri, ~7 MB | Yes, MIT (editor included) | Free | Math, Mermaid, code, tables, tasks, images; VS Code twin |
| **MarkViewer** | Inline WYSIWYG | Native, Universal | No (binaries only) | Free | AI-review loop; shipped Dec 2025, very active |
| **DOMD** | Inline WYSIWYG | Tauri, ~8.5 MB | App MIT, engine noncommercial | Free | 20 KB custom kernel, live AI token streaming, CLI |
| **MacMD Viewer** | Read-only | Native SwiftUI, ~18 MB | No | $19.99 | QuickLook + auto-refresh when an agent rewrites the file |
| **Ferrite** | Raw / rendered / split | Native Rust (egui), ~15 MB | Yes, MIT | Free | Native Mermaid, Vim, JSON/YAML/TOML, Git |
| **Inkwell** | Source + preview | Tauri, ~18 MB | Source-available | Free + $19 Pro | KaTeX, Typst PDF export, offline-first |
| **Nimbalyst** | Inline WYSIWYG | Electron | Yes, MIT | Free | Agentic-dev workspace (Claude Code / Codex) with inline AI diffs |
| **SmallDocs** | Source + preview | Node CLI → browser | Yes, MIT | Free | "CLI for you and your agents"; pipe in, share links |

**The established tools:**

| Tool | Editing | Tech / size | Open source | Price | Notable |
|---|---|---|---|---|---|
| **Typora** | True inline WYSIWYG | Electron, ~100 MB+ | No | $14.99 (3 devices) | Pandoc export, Mermaid, 200+ themes; also Win/Linux |
| **MarkText** | Real-time WYSIWYG | Electron, ~100 MB+ | Yes, MIT | Free | 57k★, revived and active in 2026 |
| **Obsidian** | Live Preview | Electron, ~100 MB+ | No | Free / $50-yr commercial | Vault-first, vast plugin ecosystem |
| **iA Writer** | Styled source | Native, light | No | $49.99 (Mac) | Focus mode, authorship (AI-vs-typed) tracking |
| **MacDown** | Source + preview | Native, light | Yes, MIT | Free | The original lightweight Mac `.md` tool |

Quill isn't the only instant opener anymore, and it isn't the most mature: MarkViewer shipped first and has an AI-review loop, and DOMD's from-scratch kernel is built to stream AI output in a way a ProseMirror-based editor isn't. Where Quill stands out is **openness and editing depth** — it's fully MIT down to the editor (MarkViewer ships binaries only, DOMD's engine is noncommercial-licensed, MacMD and Inkwell's Pro tier are paid), it has the richest writing surface of the tiny native ones (math, Mermaid, code highlighting, table controls, task lists, image-paste-to-`assets/`), and it's the only one that also runs inside VS Code. Want any instant Mac opener? Several here will do. Want a free, fully open one with the full feature set that also lives in your editor? That's Quill.

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
