// Editor construction: one Editor instance for the lifetime of the window.
// Code-highlight grammars are registered lazily into the live lowlight
// instance (no editor destroy/recreate). Markdown in and out goes through
// src/markdown (markdown-it parser + source-preserving serializer).
import { Editor, InputRule, getSchema, type AnyExtension } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import type { Slice } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import Code from '@tiptap/extension-code'
import { CharacterCount, Placeholder, Selection } from '@tiptap/extensions'
import { BlockMath, InlineMath } from '@tiptap/extension-mathematics'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { QuillImage, handleImagePaste, handleImageDrop } from './images'
import { QuillMermaid, setMermaidClickHandler } from './mermaid'
import { createLowlight } from 'lowlight'
import { icons } from './icons'
import { markdownExtensions } from './markdown/nodes'
import { getCodec, type LoadInfo } from './markdown'
import { inheritSource } from './markdown/source'
import {
  clipboardText,
  cleanPastedHtml,
  copyText,
  handleMarkdownPaste,
  promoteTableHeaders,
  richClipboardSerializer,
} from './markdown/clipboard'
import { looksLikeCurrency } from './markdown/math'
import { uxExtensions } from './extensions'

export { matchInlineMathToken, looksLikeCurrency } from './markdown/math'
export { looksLikeMarkdown, copyText } from './markdown/clipboard'

// ---------------------------------------------------------------------------
// Lazy syntax highlighting: empty lowlight instance at startup, grammars are
// fetched per-language the first time a code block uses them.
// ---------------------------------------------------------------------------

export const lowlight = createLowlight()

type GrammarLoader = () => Promise<{ default: unknown }>

const GRAMMARS: Record<string, GrammarLoader> = {
  bash: () => import('highlight.js/lib/languages/bash'),
  c: () => import('highlight.js/lib/languages/c'),
  cpp: () => import('highlight.js/lib/languages/cpp'),
  csharp: () => import('highlight.js/lib/languages/csharp'),
  css: () => import('highlight.js/lib/languages/css'),
  diff: () => import('highlight.js/lib/languages/diff'),
  go: () => import('highlight.js/lib/languages/go'),
  graphql: () => import('highlight.js/lib/languages/graphql'),
  haskell: () => import('highlight.js/lib/languages/haskell'),
  ini: () => import('highlight.js/lib/languages/ini'),
  java: () => import('highlight.js/lib/languages/java'),
  javascript: () => import('highlight.js/lib/languages/javascript'),
  json: () => import('highlight.js/lib/languages/json'),
  kotlin: () => import('highlight.js/lib/languages/kotlin'),
  latex: () => import('highlight.js/lib/languages/latex'),
  lua: () => import('highlight.js/lib/languages/lua'),
  makefile: () => import('highlight.js/lib/languages/makefile'),
  markdown: () => import('highlight.js/lib/languages/markdown'),
  matlab: () => import('highlight.js/lib/languages/matlab'),
  objectivec: () => import('highlight.js/lib/languages/objectivec'),
  perl: () => import('highlight.js/lib/languages/perl'),
  php: () => import('highlight.js/lib/languages/php'),
  python: () => import('highlight.js/lib/languages/python'),
  r: () => import('highlight.js/lib/languages/r'),
  ruby: () => import('highlight.js/lib/languages/ruby'),
  rust: () => import('highlight.js/lib/languages/rust'),
  scala: () => import('highlight.js/lib/languages/scala'),
  scss: () => import('highlight.js/lib/languages/scss'),
  sql: () => import('highlight.js/lib/languages/sql'),
  swift: () => import('highlight.js/lib/languages/swift'),
  typescript: () => import('highlight.js/lib/languages/typescript'),
  xml: () => import('highlight.js/lib/languages/xml'),
  yaml: () => import('highlight.js/lib/languages/yaml'),
  apache: () => import('highlight.js/lib/languages/apache'),
  awk: () => import('highlight.js/lib/languages/awk'),
  clojure: () => import('highlight.js/lib/languages/clojure'),
  cmake: () => import('highlight.js/lib/languages/cmake'),
  crystal: () => import('highlight.js/lib/languages/crystal'),
  d: () => import('highlight.js/lib/languages/d'),
  dart: () => import('highlight.js/lib/languages/dart'),
  dockerfile: () => import('highlight.js/lib/languages/dockerfile'),
  dos: () => import('highlight.js/lib/languages/dos'),
  elixir: () => import('highlight.js/lib/languages/elixir'),
  elm: () => import('highlight.js/lib/languages/elm'),
  erlang: () => import('highlight.js/lib/languages/erlang'),
  fortran: () => import('highlight.js/lib/languages/fortran'),
  fsharp: () => import('highlight.js/lib/languages/fsharp'),
  glsl: () => import('highlight.js/lib/languages/glsl'),
  groovy: () => import('highlight.js/lib/languages/groovy'),
  http: () => import('highlight.js/lib/languages/http'),
  julia: () => import('highlight.js/lib/languages/julia'),
  lisp: () => import('highlight.js/lib/languages/lisp'),
  llvm: () => import('highlight.js/lib/languages/llvm'),
  nginx: () => import('highlight.js/lib/languages/nginx'),
  nim: () => import('highlight.js/lib/languages/nim'),
  nix: () => import('highlight.js/lib/languages/nix'),
  ocaml: () => import('highlight.js/lib/languages/ocaml'),
  pgsql: () => import('highlight.js/lib/languages/pgsql'),
  powershell: () => import('highlight.js/lib/languages/powershell'),
  properties: () => import('highlight.js/lib/languages/properties'),
  protobuf: () => import('highlight.js/lib/languages/protobuf'),
  reasonml: () => import('highlight.js/lib/languages/reasonml'),
  scheme: () => import('highlight.js/lib/languages/scheme'),
  shell: () => import('highlight.js/lib/languages/shell'),
  tcl: () => import('highlight.js/lib/languages/tcl'),
  vbnet: () => import('highlight.js/lib/languages/vbnet'),
  verilog: () => import('highlight.js/lib/languages/verilog'),
  vhdl: () => import('highlight.js/lib/languages/vhdl'),
  vim: () => import('highlight.js/lib/languages/vim'),
  wasm: () => import('highlight.js/lib/languages/wasm'),
  x86asm: () => import('highlight.js/lib/languages/x86asm'),
}

const LANGUAGE_ALIASES: Record<string, string> = {
  sh: 'bash', zsh: 'bash', console: 'shell', 'shell-session': 'shell',
  docker: 'dockerfile', ex: 'elixir', exs: 'elixir', erl: 'erlang', clj: 'clojure',
  fs: 'fsharp', ml: 'ocaml', ps1: 'powershell', ps: 'powershell', proto: 'protobuf',
  jl: 'julia', postgres: 'pgsql', postgresql: 'pgsql', bat: 'dos', cmd: 'dos',
  asm: 'x86asm', nasm: 'x86asm', vb: 'vbnet', el: 'lisp', scm: 'scheme', vimscript: 'vim',
  'c++': 'cpp', cc: 'cpp', h: 'c',
  cs: 'csharp', 'c#': 'csharp',
  golang: 'go',
  hs: 'haskell',
  toml: 'ini',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', node: 'javascript',
  kt: 'kotlin',
  tex: 'latex',
  md: 'markdown',
  objc: 'objectivec',
  pl: 'perl',
  py: 'python', python3: 'python',
  rb: 'ruby',
  rs: 'rust',
  ts: 'typescript', tsx: 'typescript',
  html: 'xml', svg: 'xml', vue: 'xml',
  yml: 'yaml',
  plaintext: '', text: '', txt: '', plain: '',
}

export function canonicalLanguage(lang: string | null | undefined): string {
  const raw = (lang ?? '').toLowerCase().trim()
  const mapped = LANGUAGE_ALIASES[raw] ?? raw
  return mapped in GRAMMARS ? mapped : ''
}

const loadedGrammars = new Set<string>()
const pendingGrammars = new Map<string, Promise<boolean>>()

async function loadGrammar(lang: string): Promise<boolean> {
  const canonical = canonicalLanguage(lang)
  if (!canonical) return false
  if (loadedGrammars.has(canonical)) return true
  let pending = pendingGrammars.get(canonical)
  if (!pending) {
    pending = GRAMMARS[canonical]()
      .then(mod => {
        lowlight.register(canonical, mod.default as never)
        loadedGrammars.add(canonical)
        return true
      })
      .catch(err => {
        console.error(`Failed to load grammar "${canonical}":`, err)
        pendingGrammars.delete(canonical)
        return false
      })
    pendingGrammars.set(canonical, pending)
  }
  return pending
}

/** Re-run highlighting on code blocks whose grammar just arrived. */
function refreshCodeBlocks(editor: Editor, lang: string): void {
  if (editor.isDestroyed) return
  const { tr, doc } = editor.state
  let touched = false
  doc.descendants((node, pos) => {
    if (node.type.name === 'codeBlock' && canonicalLanguage(node.attrs.language) === lang) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs })
      const fresh = tr.doc.nodeAt(tr.mapping.map(pos))
      if (fresh) inheritSource(node, fresh)
      touched = true
    }
    return true
  })
  if (touched) {
    tr.setMeta('addToHistory', false)
    editor.view.dispatch(tr)
  }
}

/** Make sure grammars for every code block in the doc are (being) loaded. */
export function ensureGrammarsForDoc(editor: Editor): void {
  const wanted = new Set<string>()
  editor.state.doc.descendants(node => {
    if (node.type.name === 'codeBlock') {
      const lang = canonicalLanguage(node.attrs.language)
      if (lang && !loadedGrammars.has(lang)) wanted.add(lang)
    }
    return true
  })
  for (const lang of wanted) {
    void loadGrammar(lang).then(ok => {
      if (ok) refreshCodeBlocks(editor, lang)
    })
  }
}

// ---------------------------------------------------------------------------
// Code block node view: language picker + copy button
// ---------------------------------------------------------------------------

const LANGUAGE_LABELS: Array<[value: string, label: string]> = [
  ['', 'Plain text'],
  ...Object.keys(GRAMMARS).sort().map(l => [l, l] as [string, string]),
]

// Size the language <select> to its selected label (selects default to the
// width of their longest option, leaving the chevron stranded).
let langMeasureEl: HTMLSpanElement | null = null
// Widths per label: measuring forces a layout, so each label is measured once.
const langWidths = new Map<string, number>()
const LANGUAGE_LABEL = new Map(LANGUAGE_LABELS)

function fitLanguageSelect(select: HTMLSelectElement): void {
  const label = select.selectedOptions[0]?.textContent ?? ''
  let width = langWidths.get(label)
  if (width === undefined) {
    if (!langMeasureEl) {
      langMeasureEl = document.createElement('span')
      langMeasureEl.style.cssText =
        'position:fixed;visibility:hidden;white-space:pre;font-family:var(--font-sans);font-size:11.5px;'
      document.body.appendChild(langMeasureEl)
    }
    langMeasureEl.textContent = label
    width = Math.ceil(langMeasureEl.offsetWidth) + 28
    langWidths.set(label, width)
  }
  select.style.width = `${width}px`
}

function languageOption(value: string, label: string): HTMLOptionElement {
  const opt = document.createElement('option')
  opt.value = value
  opt.textContent = label
  return opt
}

const QuillCodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ({ node, editor, getPos }) => {
      let currentNode = node

      const dom = document.createElement('div')
      dom.className = 'code-block'

      const header = document.createElement('div')
      header.className = 'code-block-header'
      header.contentEditable = 'false'

      const select = document.createElement('select')
      select.className = 'code-block-lang'
      select.title = 'Language'
      // Only the selected <option> exists until the picker is used: a document
      // with hundreds of code blocks would otherwise build ~35 options each.
      let filled = false
      const fillOptions = () => {
        if (filled) return
        filled = true
        const current = select.value
        const custom = [...select.options].filter(o => o.value.startsWith('raw:'))
        select.textContent = ''
        select.append(languageOption('', 'Plain text'), ...custom)
        for (const [value, label] of LANGUAGE_LABELS) if (value) select.append(languageOption(value, label))
        select.value = current
      }
      select.addEventListener('mousedown', fillOptions)
      select.addEventListener('focus', fillOptions)
      // Languages without a grammar keep their label (e.g. "hcl") rather than
      // showing "Plain text".
      const syncSelect = (language: unknown) => {
        const canonical = canonicalLanguage(language as string)
        const raw = typeof language === 'string' ? language.trim() : ''
        let value = canonical
        let label = LANGUAGE_LABEL.get(canonical) ?? canonical
        if (!canonical && raw) {
          value = `raw:${raw}`
          label = raw
        }
        if (![...select.options].some(o => o.value === value)) {
          const opt = languageOption(value, label)
          if (value.startsWith('raw:') && filled) select.insertBefore(opt, select.options[1] ?? null)
          else select.appendChild(opt)
        }
        if (select.value !== value) {
          select.value = value
          fitLanguageSelect(select)
        }
      }
      syncSelect(node.attrs.language)
      fitLanguageSelect(select)
      select.addEventListener('change', () => {
        fitLanguageSelect(select)
        const pos = (getPos as () => number | undefined)()
        if (pos == null) return
        const language = select.value.startsWith('raw:') ? select.value.slice(4) : select.value || null
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(pos, undefined, { ...currentNode.attrs, language }),
        )
        if (language && canonicalLanguage(language)) {
          void loadGrammar(language).then(ok => {
            if (ok) refreshCodeBlocks(editor as Editor, language)
          })
        }
        editor.commands.focus()
      })

      const copyBtn = document.createElement('button')
      copyBtn.className = 'code-block-copy'
      copyBtn.type = 'button'
      copyBtn.title = 'Copy code'
      copyBtn.innerHTML = icons.copy
      copyBtn.addEventListener('mousedown', e => e.preventDefault())
      copyBtn.addEventListener('click', () => {
        // copyText runs the synchronous execCommand path first, inside this
        // click, so WKWebView's clipboard permission rules don't bite.
        void copyText(currentNode.textContent).then(ok => {
          copyBtn.innerHTML = ok ? icons.check : icons.copy
          copyBtn.classList.add(ok ? 'copied' : 'copy-failed')
          copyBtn.title = ok ? 'Copied' : 'Copy failed: select the code and press ⌘C'
          copyBtn.setAttribute('data-copy-state', ok ? 'copied' : 'failed')
          setTimeout(() => {
            copyBtn.innerHTML = icons.copy
            copyBtn.classList.remove('copied', 'copy-failed')
            copyBtn.title = 'Copy code'
            copyBtn.removeAttribute('data-copy-state')
          }, ok ? 1200 : 2500)
        })
      })

      header.append(select, copyBtn)

      const pre = document.createElement('pre')
      const code = document.createElement('code')
      pre.appendChild(code)
      dom.append(header, pre)

      return {
        dom,
        contentDOM: code,
        update(updated) {
          if (updated.type.name !== 'codeBlock') return false
          currentNode = updated
          syncSelect(updated.attrs.language)
          return true
        },
        ignoreMutation(mutation) {
          return !code.contains(mutation.target)
        },
      }
    }
  },
})

// ---------------------------------------------------------------------------
// Editor factory
// ---------------------------------------------------------------------------

export interface EditorCallbacks {
  onDocChanged: () => void
  /** Plain (non-modifier) click on a link */
  onLinkClick: (anchor: HTMLAnchorElement, pos: number) => void
  onInlineMathClick: (node: { attrs: { latex: string } }, pos: number) => void
  onBlockMathClick: (node: { attrs: { latex: string } }, pos: number) => void
  onMermaidClick: (code: string, pos: number) => void
  onOpenUrl: (url: string) => void
}

const katexMacros = {
  '\\R': '\\mathbb{R}',
  '\\N': '\\mathbb{N}',
  '\\Z': '\\mathbb{Z}',
  '\\Q': '\\mathbb{Q}',
  '\\C': '\\mathbb{C}',
}

// The stock inline-math input rule wants "$$$..."; this one converts
//   $E=mc^2$  -> inline math node (not currency like "$5-" or "$20,")
// Markdown parsing of math lives in src/markdown/md.ts.
const QuillInlineMath = InlineMath.extend({
  addInputRules() {
    return [
      new InputRule({
        find: /\$([^\s$](?:[^$\n]*[^\s$])?)\$$/,
        handler: ({ state, range, match }) => {
          const latex = match[1].trim()
          if (!latex || looksLikeCurrency(latex)) return
          // A digit right after the closing $ means a currency range like
          // "$5-$10" being typed or edited, not math.
          const $to = state.doc.resolve(range.to)
          const after = $to.parent.textBetween(
            $to.parentOffset,
            Math.min($to.parentOffset + 1, $to.parent.content.size),
          )
          if (/\d/.test(after)) return
          // A "$" right before the match means the user is typing "$$...$$";
          // leave that to the block rule.
          if (range.from > 0 && state.doc.textBetween(range.from - 1, range.from) === '$') return
          // The rule's text matching flattens inline atoms to placeholders;
          // never convert across existing nodes (math, images, ...).
          let crossesAtom = false
          state.doc.nodesBetween(range.from, range.to, node => {
            if (node.isLeaf && !node.isText) crossesAtom = true
            return !crossesAtom
          })
          if (crossesAtom) return
          state.tr.replaceWith(range.from, range.to, this.type.create({ latex }))
        },
      }),
    ]
  },
})

const QuillBlockMath = BlockMath.extend({
  addInputRules() {
    return [
      ...(this.parent?.() ?? []),
      new InputRule({
        find: /^\$\$([^$\n]+)\$\$$/,
        handler: ({ state, range, match }) => {
          const latex = match[1].trim()
          if (!latex) return
          // When the match spans the whole paragraph, replace the paragraph
          // itself; replacing only its text leaves an empty paragraph behind.
          const $from = state.doc.resolve(range.from)
          const wholeBlock = $from.parentOffset === 0 && range.to === range.from + $from.parent.content.size
          if (wholeBlock) {
            state.tr.replaceWith(range.from - 1, range.to + 1, this.type.create({ latex }))
          } else {
            state.tr.replaceWith(range.from, range.to, this.type.create({ latex }))
          }
        },
      }),
    ]
  },
})

// Code can carry bold/italic/link (`**`x`**`, [`x`](u) are common in docs);
// the stock mark excludes every other mark.
const QuillCode = Code.extend({ excludes: '' })

const noop = () => {}
const NOOP_CALLBACKS: EditorCallbacks = {
  onDocChanged: noop,
  onLinkClick: noop,
  onInlineMathClick: noop,
  onBlockMathClick: noop,
  onMermaidClick: noop,
  onOpenUrl: noop,
}

/** The editor's extensions (also used headless by tests to build the schema). */
export function quillExtensions(callbacks: EditorCallbacks = NOOP_CALLBACKS): AnyExtension[] {
  return [
    StarterKit.configure({
      codeBlock: false,
      code: false,
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: 'https',
      },
      trailingNode: {
        node: 'paragraph',
      },
      // Heading levels 1-6, default config otherwise
    }),
    QuillCode,
    QuillMermaid,
    QuillCodeBlock.configure({
      lowlight,
      defaultLanguage: null,
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({
      table: { resizable: false, allowTableNodeSelection: true },
    }),
    QuillImage,
    ...markdownExtensions,
    Placeholder.configure({
      placeholder: ({ node }) => {
        if (node.type.name === 'heading') return 'Heading'
        return "Write, or press '/' for blocks…"
      },
      includeChildren: false,
    }),
    Selection,
    CharacterCount,
    // No Typography: arrows, dashes and curly quotes rewrite commands and
    // flags ("--force", "->", "\"x\"") in a technical editor.
    QuillInlineMath.configure({
      onClick: (node, pos) => callbacks.onInlineMathClick(node as never, pos),
      katexOptions: {
        throwOnError: false,
        macros: katexMacros,
      },
    }),
    QuillBlockMath.configure({
      onClick: (node, pos) => callbacks.onBlockMathClick(node as never, pos),
      katexOptions: {
        throwOnError: false,
        macros: katexMacros,
        // Block equations render display-style (limits above/below operators)
        displayMode: true,
      },
    }),
    // Interaction layer (links, heading ids, shortcuts, table controls, highlight).
    ...uxExtensions,
  ]
}

/** Schema without an editor (tests, harness). */
export function quillSchema() {
  return getSchema(quillExtensions())
}

export function createQuillEditor(element: HTMLElement, callbacks: EditorCallbacks): Editor {
  // Wire the mermaid node-view click through the module-level handler so
  // nodeViews (which don't receive custom callbacks) can reach main.ts.
  setMermaidClickHandler((code, pos) => callbacks.onMermaidClick(code, pos))

  const editor: Editor = new Editor({
    element,
    // autofocus runs the focus command in a setTimeout; with content loaded in
    // between it dispatches a stale transaction. main.ts focuses after boot.
    autofocus: false,
    extensions: quillExtensions(callbacks),
    editorProps: {
      attributes: {
        class: 'tiptap',
        spellcheck: 'true',
        // macOS auto-capitalise/autocorrect rewrite commands, identifiers
        // and table cells as you type; spelling underlines stay.
        autocorrect: 'off',
        autocapitalize: 'off',
      },
      // text/plain: markdown (raw code for an all-code selection) so pasting
      // into other apps keeps structure. text/html: rich HTML other apps can
      // render (math source, mermaid SVG, absolute image URLs).
      clipboardTextSerializer: (slice: Slice) => {
        try {
          return clipboardText(editor.schema, slice)
        } catch (e) {
          console.error('markdown clipboard serialize failed:', e)
          return slice.content.textBetween(0, slice.content.size, '\n\n', ' ')
        }
      },
      clipboardSerializer: undefined,
      transformPastedHTML: (html: string) => cleanPastedHtml(html),
      transformPasted: (slice: Slice) => promoteTableHeaders(slice, editor.schema),
      handlePaste: (view: EditorView, event: ClipboardEvent) => {
        // Pasted image data wins over text handling (writes to disk + inserts).
        if (handleImagePaste(editor, event)) return true
        const handled = handleMarkdownPaste(view, event)
        if (handled) ensureGrammarsForDoc(editor)
        return handled
      },
      handleDrop: (_view: EditorView, event: DragEvent) => {
        // Dropped image files write to disk + insert at the drop point.
        return handleImageDrop(editor, event)
      },
      handleClick: (view: EditorView, pos: number, event: MouseEvent) => {
        const target = (event.target as HTMLElement).closest('a')
        if (!target) return false
        const href = target.getAttribute('href')
        if (!href) return false
        // Returning true suppresses ProseMirror's own click handling, so
        // place the caret at the clicked position ourselves.
        try {
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
        } catch {
          // Position edge cases: leave the selection as is.
        }
        if (event.metaKey || event.ctrlKey) {
          callbacks.onOpenUrl(href)
        } else {
          callbacks.onLinkClick(target as HTMLAnchorElement, pos)
        }
        return true
      },
    },
    onUpdate: ({ transaction }) => {
      if (transaction.docChanged) callbacks.onDocChanged()
    },
  })
  editor.view.setProps({ clipboardSerializer: richClipboardSerializer(editor.schema) })

  // Clicking the empty space below the last block puts the caret at the end.
  const container = element.closest('#editor-container') ?? element
  container.addEventListener('mousedown', e => {
    if (e.target !== container && e.target !== element) return
    const event = e as MouseEvent
    const editorRect = element.getBoundingClientRect()
    if (event.clientY > editorRect.bottom) {
      e.preventDefault()
      editor.commands.focus('end')
    } else if (event.target === container) {
      // Click in the horizontal gutter: focus nearest position
      e.preventDefault()
      const pos = editor.view.posAtCoords({ left: editorRect.left + 1, top: event.clientY })
      editor.commands.focus(pos?.pos ?? 'end')
    }
  })

  // Debug / harness hook for the markdown layer (no app data).
  ;(window as unknown as { quillMarkdown?: unknown }).quillMarkdown = {
    /** load -> save through the app path, with source preservation off. */
    serializeFresh: (md: string) => {
      const codec = getCodec(editor.schema)
      return codec.serialize(codec.parse(md).doc, { preserve: false })
    },
    load: () => loads.get(editor) ?? null,
  }

  return editor
}

// ---------------------------------------------------------------------------
// Load / save
// ---------------------------------------------------------------------------

/** The parse of the file currently in each editor (for verbatim saving). */
const loads = new WeakMap<Editor, LoadInfo>()

/** Markdown for the whole document. Unedited blocks are written verbatim. */
export function getMarkdown(editor: Editor): string {
  return getCodec(editor.schema).serialize(editor.state.doc, { load: loads.get(editor) ?? null })
}

/**
 * Replace the document from a markdown string. For loading a file (the
 * default) the load is not undoable: history is reset, so Cmd+Z can't bring
 * back the previous file's content under the new file's name. Pass
 * `{ undoable: true }` for in-document rewrites (e.g. applying source-view
 * edits) to make it one undo step and keep earlier history.
 */
export function setMarkdown(editor: Editor, markdown: string, opts: { undoable?: boolean } = {}): void {
  const { doc, info } = getCodec(editor.schema).parse(markdown)
  loads.set(editor, info)
  const view = editor.view
  // Dispatch so listeners (word count, dirty state, plugins) see the change...
  const tr = view.state.tr
    .replaceWith(0, view.state.doc.content.size, doc.content)
    .setMeta('quillLoad', true)
  if (!opts.undoable) tr.setMeta('addToHistory', false)
  tr.setSelection(TextSelection.atStart(tr.doc))
  view.dispatch(tr)
  if (opts.undoable) {
    ensureGrammarsForDoc(editor)
    return
  }
  // ...then reset only the undo history (re-adding the history plugin
  // re-initialises its state; every other plugin keeps its state).
  const plugins = view.state.plugins
  // PluginKey names are "<name>$<n>"; Plugin.key isn't in the public typings.
  const isHistory = (p: object) => String((p as { key?: string }).key ?? '').startsWith('history$')
  if (plugins.some(isHistory)) {
    const without = view.state.reconfigure({ plugins: plugins.filter(p => !isHistory(p)) })
    view.updateState(without.reconfigure({ plugins }))
  }
  ensureGrammarsForDoc(editor)
}
