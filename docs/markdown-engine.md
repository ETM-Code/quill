# Markdown engine: decision record

Quill is the default `.md` app for drafts that agents write, so the rule is:
**opening and saving a file must never change what it means.** This note records
how the markdown layer was chosen and what it now guarantees.

## Decision

**Adopt** markdown-it (MIT) as the parser. **Borrow** the writer from
prosemirror-markdown (MIT): its block/mark state machine is adapted in
`src/markdown/serialize.ts`, with escaping and list indentation rewritten to be
exact for markdown-it. **Reject** patching `@tiptap/markdown` and **reject**
remark/mdast.

On top of the parser and writer sits **source preservation**: every top-level
block keeps its original text, and every paragraph, heading and table cell keeps
its original inline source. ProseMirror replaces only edited nodes, so an
unedited block is written back byte for byte and an edited list or quote keeps
its untouched lines exactly as written. The serializer only has to be correct
(not pretty) for content the user actually changed.

## Candidates, measured

The bar: the 107-case audit corpus plus 51 extra edge cases
(`harness/fidelity-cases.ts`), 60 real Claude-written files
(`harness/fixtures/realworld-files.txt`), judged by markdown-it as an independent
oracle (`harness/fidelity-lib.ts`). Timing is for the 202 KB `tmp-test-files/large.md`.
Sizes are minified + gzip -9 of the markdown layer alone.

| | (a) `@tiptap/markdown` (marked) as shipped | (c) remark (unified + gfm + math + frontmatter) | (b) markdown-it + Quill writer (adopted) |
|---|---|---|---|
| Corpus meaning changes | 36 of 107 | 9 of 158 (md→mdast→md alone, before any ProseMirror mapping) | **0 of 158** (serializer alone, every block treated as edited) |
| Unstable on 2nd pass | 5 | 0 | **0** |
| Real files changed by open→save | 34 of 60 | 3 of 60 changed meaning, 0 of 60 byte-identical | **0 of 60; all 60 byte-identical** |
| Parse, 200 KB | 5.7 s in one call (quadratic lexer); 130 ms only with the chunking workaround | 180 ms (bun) | **32 ms** (bun), 26 ms parse+serialize in WebKit |
| Size (gzip) | 16.8 KB | 49.6 KB, plus a ProseMirror mapping still to write | 25.5 KB markdown-it + plugins (entities table swapped for the browser's decoder) + 14 KB Quill code |

Why not (a): the audit traced most bugs to `@tiptap/markdown` itself: no
escape handling either way, global list indentation, mark nesting, soft breaks
flattened, a quadratic lexer. That's a rewrite of its serializer and tokenizer
hooks across every extension, with marked's tokens lacking source positions,
so preservation would still need its own layer.

Why not (c): it is heavier and slower, still changes meaning on its own
round trip (it normalises escapes, emphasis and lists to its own style), and
would need an mdast↔ProseMirror mapping of the same size as (b).

Why (b): markdown-it was already in the dependency tree (via `@tiptap/pm`), it
is the CommonMark reference-grade parser the oracle uses, it gives block line
maps (which source preservation needs), it is linear time, and its plugin API
covers footnotes and highlight. prosemirror-markdown's writer is mature (fence
lengths, mark ordering, whitespace expulsion) and only needed Quill's schema
names and exact escaping.

Cost: about +23 KB gzip in the main chunk. DOMPurify (12 KB gzip) is loaded
lazily, only when a document has raw HTML to display, and the `entities` table
in markdown-it is swapped for the browser's decoder in production builds
(`vite.config.ts`, checked against `entities` in the gate).

## What the layer guarantees

- **Open then save is byte-identical**, including blank-line runs, a missing
  final newline, CRLF line endings (restored by `file-ops.ts`), link reference
  definitions and anything the editor has no node for (kept as verbatim
  `markdownSource` blocks).
- **Edited content keeps its meaning** under markdown-it, and a second save is
  byte-identical to the first.
- Allowed normalisations when a block is re-written (listed in
  `harness/fidelity-lib.ts`): setext → ATX headings, `_x_`/`__x__` → `*x*`/`**x**`,
  `1)`/renumbering → sequential, indented code → fenced, `<b>`/`<i>` kept as
  tags, two-space hard breaks → `\`, entities → characters, and the nesting
  order of marks that cover exactly the same text.

## Supported constructs

CommonMark; GFM tables (alignment, escaped pipes also inside code), task lists,
strikethrough (`~~` only: single `~` stays text), autolinks and bare URLs;
footnotes (definitions stay where written); YAML/TOML front matter (collapsed
"Properties" block, verbatim); GitHub alerts / Obsidian callouts (`> [!NOTE]`,
styled by decoration, marker kept in the text); `<details>`/`<summary>` with
editable markdown inside; `==highlight==`; `<sub>`, `<sup>`, `<kbd>`, `<u>`,
`<mark>` as marks; any other inline or block HTML kept verbatim and shown
sanitised (DOMPurify); comments; inline `$…$` (Pandoc currency rules) and
`\(…\)`; block `$$…$$` and `\[…\]`; mermaid fences; soft line breaks (shown as a
space, saved as a newline).

Not rendered (kept verbatim as text): `~sub~`/`^sup^`, wikilinks, emoji
shortcodes, definition lists, `[TOC]`.

## Where things live

| File | Role |
|---|---|
| `src/markdown/md.ts` | markdown-it setup: footnotes, mark, math, task lists, front matter split |
| `src/markdown/parse.ts` | tokens → ProseMirror doc, source capture |
| `src/markdown/source.ts` | WeakMaps from parsed nodes to their source |
| `src/markdown/serialize.ts` | writer (adapted from prosemirror-markdown) |
| `src/markdown/nodes.ts` | schema additions: front matter, raw HTML, soft breaks, footnotes, details, marks, callouts, Enter in cells |
| `src/markdown/clipboard.ts` | copy (markdown / raw code text, rich HTML) and paste (markdown, VS Code, TSV/CSV, chat code blocks) |
| `harness/fidelity-gate.ts` | the gate: `bun harness/fidelity-gate.ts` |
