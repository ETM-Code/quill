// Editor construction: one Editor instance for the lifetime of the window.
// Code-highlight grammars are registered lazily into the live lowlight
// instance (no editor destroy/recreate), markdown round-trips through the
// per-extension specs (math included — no post-parse migration needed).
import { Editor, InputRule } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import type { Slice } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { CharacterCount, Placeholder, Selection } from '@tiptap/extensions'
import Typography from '@tiptap/extension-typography'
import { BlockMath, InlineMath } from '@tiptap/extension-mathematics'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { createLowlight } from 'lowlight'
import { icons } from './icons'

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
}

const LANGUAGE_ALIASES: Record<string, string> = {
  sh: 'bash', shell: 'bash', zsh: 'bash',
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

function fitLanguageSelect(select: HTMLSelectElement): void {
  if (!langMeasureEl) {
    langMeasureEl = document.createElement('span')
    langMeasureEl.style.cssText =
      'position:fixed;visibility:hidden;white-space:pre;font-family:var(--font-sans);font-size:11.5px;'
    document.body.appendChild(langMeasureEl)
  }
  langMeasureEl.textContent = select.selectedOptions[0]?.textContent ?? ''
  select.style.width = `${Math.ceil(langMeasureEl.offsetWidth) + 28}px`
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
      for (const [value, label] of LANGUAGE_LABELS) {
        const opt = document.createElement('option')
        opt.value = value
        opt.textContent = label
        select.appendChild(opt)
      }
      select.value = canonicalLanguage(node.attrs.language)
      fitLanguageSelect(select)
      select.addEventListener('change', () => {
        fitLanguageSelect(select)
        const pos = (getPos as () => number | undefined)()
        if (pos == null) return
        const language = select.value || null
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(pos, undefined, { ...currentNode.attrs, language }),
        )
        if (language) {
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
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(currentNode.textContent).then(() => {
          copyBtn.innerHTML = icons.check
          copyBtn.classList.add('copied')
          setTimeout(() => {
            copyBtn.innerHTML = icons.copy
            copyBtn.classList.remove('copied')
          }, 1200)
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
          const lang = canonicalLanguage(updated.attrs.language)
          if (select.value !== lang) {
            select.value = lang
            fitLanguageSelect(select)
          }
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
// Markdown clipboard
// ---------------------------------------------------------------------------

const MARKDOWN_HINTS = [
  /^#{1,6}\s\S/m,            // heading
  /^```/m,                   // fence
  /\[[^\]\n]+\]\([^)\s]+\)/, // link
  /\*\*[^*\n]+\*\*/,         // bold
  /^>\s\S/m,                 // blockquote
  /^\|.+\|\s*$/m,            // table row
  /^(-|\*|\+|\d+\.)\s\S.*\n(-|\*|\+|\d+\.)\s/m, // 2+ list items
  /^- \[[ x]\]\s/m,          // task item
  /^(---|\*\*\*)\s*$/m,      // hr
]

export function looksLikeMarkdown(text: string): boolean {
  if (text.length < 4) return false
  return MARKDOWN_HINTS.some(re => re.test(text))
}

// ---------------------------------------------------------------------------
// Editor factory
// ---------------------------------------------------------------------------

export interface EditorCallbacks {
  onDocChanged: () => void
  /** Plain (non-modifier) click on a link */
  onLinkClick: (anchor: HTMLAnchorElement, pos: number) => void
  onInlineMathClick: (node: { attrs: { latex: string } }, pos: number) => void
  onBlockMathClick: (node: { attrs: { latex: string } }, pos: number) => void
  onOpenUrl: (url: string) => void
}

const katexMacros = {
  '\\R': '\\mathbb{R}',
  '\\N': '\\mathbb{N}',
  '\\Z': '\\mathbb{Z}',
  '\\Q': '\\mathbb{Q}',
  '\\C': '\\mathbb{C}',
}

// Live-typing math: the stock extension only parses $...$ from markdown files
// (and its sole input rule wants "$$$..."). These make typing work:
//   $E=mc^2$  -> inline math node (not for plain numbers like "$5")
//   $$..$$    -> block math node
const QuillInlineMath = InlineMath.extend({
  addInputRules() {
    return [
      new InputRule({
        find: /\$([^\s$](?:[^$\n]*[^\s$])?)\$$/,
        handler: ({ state, range, match }) => {
          const latex = match[1].trim()
          if (!latex || /^\d+(?:[.,]\d+)?$/.test(latex)) return
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

export function createQuillEditor(element: HTMLElement, callbacks: EditorCallbacks): Editor {
  const editor: Editor = new Editor({
    element,
    // autofocus runs the focus command in a setTimeout; with content loaded in
    // between it dispatches a stale transaction. main.ts focuses after boot.
    autofocus: false,
    contentType: 'markdown',
    content: '',
    extensions: [
      StarterKit.configure({
        codeBlock: false,
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
      QuillCodeBlock.configure({
        lowlight,
        defaultLanguage: null,
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({
        table: { resizable: false, allowTableNodeSelection: true },
      }),
      Markdown,
      Placeholder.configure({
        placeholder: ({ node }) => {
          if (node.type.name === 'heading') return 'Heading'
          return "Write, or press '/' for blocks…"
        },
        includeChildren: false,
      }),
      Selection,
      CharacterCount,
      Typography.configure({
        // "^2"/"^3" -> ²/³ would corrupt LaTeX while typing $...$ math
        superscriptTwo: false,
        superscriptThree: false,
      }),
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
    ],
    editorProps: {
      attributes: {
        class: 'tiptap',
        spellcheck: 'true',
      },
      // Copy/cut put markdown on the plain-text clipboard so pasting into
      // other apps preserves structure. (text/html still carries rich copy.)
      clipboardTextSerializer: (slice: Slice) => {
        try {
          const content = slice.content.toJSON()
          if (!content) return ''
          const md = editor.markdown?.serialize({ type: 'doc', content })
          if (typeof md === 'string') return md.replace(/\n+$/, '')
        } catch (e) {
          console.error('markdown clipboard serialize failed:', e)
        }
        return slice.content.textBetween(0, slice.content.size, '\n')
      },
      // Pasting markdown-looking plain text parses it into rich content.
      handlePaste: (view: EditorView, event: ClipboardEvent) => {
        const clipboard = event.clipboardData
        if (!clipboard) return false
        const html = clipboard.getData('text/html')
        const text = clipboard.getData('text/plain')
        if (html || !text || !looksLikeMarkdown(text)) return false
        // Don't markdown-parse into code blocks
        const { $from } = view.state.selection
        if ($from.parent.type.name === 'codeBlock') return false
        try {
          const json = editor.markdown?.parse(text) as JSONNode | null
          const nodes = json ? (normalizeSoftBreaks(json).content ?? []) : []
          if (nodes.length > 0) {
            editor.commands.insertContent(nodes as never)
            ensureGrammarsForDoc(editor)
            return true
          }
        } catch (e) {
          console.error('markdown paste parse failed:', e)
        }
        return false
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

  return editor
}

/** Markdown for the whole document. */
export function getMarkdown(editor: Editor): string {
  let md = editor.getMarkdown()
  // Trailing empty paragraphs (e.g. the always-present trailing node)
  // serialize as `&nbsp;` lines; don't persist those.
  md = md.replace(/(?:\n+&nbsp;[ \t]*)+\s*$/, '').replace(/^&nbsp;[ \t]*$/, '')
  if (md && !md.endsWith('\n')) md += '\n'
  return md
}

// ---------------------------------------------------------------------------
// Fast markdown parsing for large documents.
//
// marked's lexer is quadratic in input size (it rescans the remaining source
// per block token): 209KB ≈ 5.7s in one call, ~170ms parsed in ~6KB chunks.
// Chunking is only safe at boundaries that can't change parse results, so we
// split at blank lines whose next line clearly starts a fresh top-level block.
// ---------------------------------------------------------------------------

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/
// Lines that may belong to the previous block: indented continuations, list
// items (loose lists!), blockquotes, table rows, setext underlines.
const UNSAFE_BLOCK_START_RE = /^(\s|[-*+>|]|\d+[.)]|=+\s*$)/
const LINK_DEF_RE = /^\s{0,3}\[[^\]]+\]:\s/m

const CHUNK_MIN_LINES = 220

export function splitMarkdownForParsing(markdown: string): string[] {
  const lines = markdown.split('\n')
  const chunks: string[] = []
  let buf: string[] = []
  let fence: string | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fenceMatch = FENCE_RE.exec(line)
    if (fenceMatch) {
      if (fence === null) {
        fence = fenceMatch[1]
      } else if (fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) {
        fence = null
      }
    }
    buf.push(line)

    if (
      fence === null
      && buf.length >= CHUNK_MIN_LINES
      && line.trim() === ''
      && i + 1 < lines.length
      && lines[i + 1].trim() !== ''
      && !UNSAFE_BLOCK_START_RE.test(lines[i + 1])
    ) {
      chunks.push(buf.join('\n'))
      buf = []
    }
  }
  if (buf.length) chunks.push(buf.join('\n'))
  return chunks
}

type DocJSON = { type: 'doc'; content: unknown[] }

type JSONNode = {
  type?: string
  text?: string
  content?: JSONNode[]
}

/**
 * CommonMark soft breaks (single newlines inside a paragraph) must render as
 * spaces. marked leaves them as "\n" in text tokens, and ProseMirror renders
 * with white-space: pre-wrap, so without this hard-wrapped source files would
 * display with forced line breaks. Code blocks keep their newlines.
 */
export function normalizeSoftBreaks(node: JSONNode): JSONNode {
  if (node.type === 'codeBlock') return node
  if (typeof node.text === 'string' && node.text.includes('\n')) {
    node.text = node.text.replace(/[ \t]*\n[ \t]*/g, ' ')
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) normalizeSoftBreaks(child)
  }
  return node
}

export function parseMarkdownFast(editor: Editor, markdown: string): DocJSON | string {
  const manager = editor.markdown
  if (!manager) return markdown

  try {
    const content: unknown[] = []
    if (
      markdown.length < 10_000
      || LINK_DEF_RE.test(markdown)
      || splitMarkdownForParsing(markdown).length < 2
    ) {
      const json = manager.parse(markdown) as JSONNode | null
      if (json?.content) content.push(...json.content)
    } else {
      for (const chunk of splitMarkdownForParsing(markdown)) {
        const json = manager.parse(chunk) as JSONNode | null
        if (json?.content) content.push(...json.content)
      }
    }
    return normalizeSoftBreaks({ type: 'doc', content: content as JSONNode[] }) as DocJSON
  } catch (e) {
    console.error('markdown parse failed, falling back to setContent:', e)
    return markdown
  }
}

/** Replace the document from a markdown string (load/open path). */
export function setMarkdown(editor: Editor, markdown: string): void {
  const content = parseMarkdownFast(editor, markdown)
  if (typeof content === 'string') {
    editor.commands.setContent(content, { contentType: 'markdown' })
  } else {
    editor.commands.setContent(content as never)
  }
  // setContent maps the old selection through the replace, which can leave a
  // silent whole-document selection; later commands would apply to all of it.
  editor.commands.setTextSelection(0)
  ensureGrammarsForDoc(editor)
}
