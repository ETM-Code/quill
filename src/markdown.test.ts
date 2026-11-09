// Unit tests for the markdown codec (src/markdown): escaping, lists, marks,
// tables, front matter, source preservation. Headless: schema only.
import { describe, expect, test } from 'bun:test'
import { canonicalLanguage, looksLikeMarkdown, quillSchema } from './editor-setup'
import { getCodec } from './markdown'
import { parseDelimited, codeOnlyText } from './markdown/clipboard'
import { Slice } from '@tiptap/pm/model'

const schema = quillSchema()
const codec = getCodec(schema)
/** Serialize as if every block had been edited (no source reuse). */
const fresh = (md: string) => codec.serialize(codec.parse(md).doc, { preserve: false })
const saved = (md: string) => {
  const { doc, info } = codec.parse(md)
  return codec.serialize(doc, { load: info })
}
const p = (...content: ReturnType<typeof schema.text>[]) => schema.nodes.paragraph.create(null, content)
const docOf = (...blocks: ReturnType<typeof p>[]) => schema.nodes.doc.create(null, blocks)
const ser = (doc: ReturnType<typeof docOf>) => codec.serialize(doc, { preserve: false })
const t = (s: string, ...marks: string[]) => schema.text(s, marks.map(m => schema.marks[m].create()))

describe('escaping', () => {
  test('literal markdown characters typed as text stay literal', () => {
    for (const lit of ['*not em*', '# not heading', '1. not list', '- not list', '> not quote', '[x](y)', '_u_', '~~x~~', '`x`', '==x==', '$x$', '+ plus', '1986. A year']) {
      const md = ser(docOf(p(t(lit))))
      const back = codec.parse(md).doc
      expect(back.textContent).toBe(lit)
      expect(back.firstChild!.firstChild!.marks.length).toBe(0)
    }
  })
  test('no needless escapes', () => {
    expect(ser(docOf(p(t('snake_case and C:\\Users\\me and a < b & c, ~5 min, $5 and $10'))))).toBe('snake_case and C:\\Users\\me and a < b & c, ~5 min, $5 and $10\n')
  })
  test('angle-bracket placeholders survive', () => {
    expect(saved('Replace <API_KEY> and Vec<T>.\n')).toBe('Replace <API_KEY> and Vec<T>.\n')
    expect(codec.parse('Replace <API_KEY>.\n').doc.textContent).toBe('Replace <API_KEY>.')
    expect(ser(docOf(p(t('a <b> tag'))))).toBe('a \\<b> tag\n')
  })
  test('backslash escapes are kept on load', () => {
    expect(codec.parse('\\*not em\\* 1986\\. x\n').doc.textContent).toBe('*not em* 1986. x')
  })
})

describe('lists', () => {
  test('children of ordered items are indented to the content column', () => {
    expect(fresh('1. one\n   - sub\n2. two\n')).toBe('1. one\n   - sub\n2. two\n')
    expect(fresh('10. ten\n    - sub\n')).toBe('10. ten\n    - sub\n')
  })
  test('multi-paragraph items stay loose', () => {
    expect(fresh('1. first\n\n   second\n\n2. next\n')).toBe('1. first\n\n   second\n\n2. next\n')
  })
  test('bullet character and tightness are kept', () => {
    expect(fresh('* a\n* b\n')).toBe('* a\n* b\n')
    expect(fresh('- a\n\n- b\n')).toBe('- a\n\n- b\n')
  })
  test('adjacent lists do not merge', () => {
    const out = fresh('- a\n\n* b\n')
    expect(codec.parse(out).doc.childCount).toBe(2)
  })
  test('task lists', () => {
    expect(fresh('- [ ] todo\n- [x] done\n')).toBe('- [ ] todo\n- [x] done\n')
  })
})

describe('marks', () => {
  test('code is innermost, link outermost', () => {
    expect(fresh('**x `code`**\n')).toBe('**x `code`**\n')
    expect(fresh('[`demo/`](demo/)\n')).toBe('[`demo/`](demo/)\n')
    expect(fresh('**`f1d4`**\n')).toBe('**`f1d4`**\n')
  })
  test('code spans pick a safe fence', () => {
    expect(fresh('use ``a ` b`` ok\n')).toBe('use ``a ` b`` ok\n')
  })
  test('underline is written as <u>', () => {
    expect(ser(docOf(p(t('x', 'underline'))))).toBe('<u>x</u>\n')
  })
  test('non-flanking emphasis falls back to HTML', () => {
    const md = ser(docOf(p(t('"q"', 'bold'), t('x'))))
    expect(md).toBe('<strong>"q"</strong>x\n')
  })
  test('single tilde is not strikethrough', () => {
    expect(codec.parse('H~2~O ~5\n').doc.firstChild!.firstChild!.marks.length).toBe(0)
  })
})

describe('tables', () => {
  test('pipes in cells and code are escaped', () => {
    const out = fresh('| a | b |\n|---|---|\n| `x \\| y` | z \\| w |\n')
    const cell = codec.parse(out).doc.firstChild!.child(1).child(0)
    expect(cell.textContent).toBe('x | y')
  })
  test('empty cells stay empty, alignment kept', () => {
    expect(fresh('| L | R |\n|:--|--:|\n|  | 2 |\n')).toBe('| L   | R   |\n| :-- | --: |\n|     | 2   |\n')
  })
  test('first row is always the header', () => {
    const cell = (s: string) => schema.nodes.tableCell.create(null, p(t(s)))
    const row = (...c: string[]) => schema.nodes.tableRow.create(null, c.map(cell))
    const doc = schema.nodes.doc.create(null, [schema.nodes.table.create(null, [row('a', 'b'), row('1', '2')])])
    expect(ser(doc)).toBe('| a   | b   |\n| --- | --- |\n| 1   | 2   |\n')
  })
})

describe('front matter and verbatim blocks', () => {
  test('front matter is kept verbatim', () => {
    const md = '---\ntitle: Hello\ntags: [a, b]\n---\n\n# Body\n'
    const { doc } = codec.parse(md)
    expect(doc.firstChild!.type.name).toBe('frontMatter')
    expect(fresh(md)).toBe(md)
  })
  test('a leading thematic break is not front matter', () => {
    expect(codec.parse('---\n\ntext\n').doc.firstChild!.type.name).toBe('horizontalRule')
  })
  test('unedited documents save byte for byte', () => {
    const md = 'Title\n=====\n\n* a\n* b\n\n\n[ref]: https://x.com\nlast line no newline'
    expect(saved(md)).toBe(md)
  })
  test('soft line breaks are kept', () => {
    expect(fresh('line one\nline two\n')).toBe('line one\nline two\n')
  })
})

describe('clipboard helpers', () => {
  test('TSV and CSV detection', () => {
    expect(parseDelimited('a\tb\n1\t2\n')).toEqual([['a', 'b'], ['1', '2']])
    expect(parseDelimited('name,qty\napple,3\n')).toEqual([['name', 'qty'], ['apple', '3']])
    expect(parseDelimited('Hello there, this is a sentence.\nAnother line, here.')).toBeNull()
  })
  test('code-only selections copy raw code', () => {
    const code = 'cargo build \\\n  --flag "quoted" $VAR\n\tdone'
    const block = schema.nodes.codeBlock.create(null, schema.text(code))
    expect(codeOnlyText(new Slice(schema.nodes.doc.create(null, [block]).content, 0, 0))).toBe(code)
  })
})

describe('looksLikeMarkdown', () => {
  test('block and inline markdown', () => {
    expect(looksLikeMarkdown('# Heading\n\nbody')).toBe(true)
    expect(looksLikeMarkdown('some **bold** here')).toBe(true)
    expect(looksLikeMarkdown('Use `foo()` and *emphasis*')).toBe(true)
    expect(looksLikeMarkdown('- single item')).toBe(true)
    expect(looksLikeMarkdown('[x](https://y.z)')).toBe(true)
  })
  test('plain text', () => {
    expect(looksLikeMarkdown('just a sentence with 5 * 3 math')).toBe(false)
    expect(looksLikeMarkdown('one line')).toBe(false)
  })
})

describe('canonicalLanguage', () => {
  test('aliases and unknowns', () => {
    expect(canonicalLanguage('js')).toBe('javascript')
    expect(canonicalLanguage('PY')).toBe('python')
    expect(canonicalLanguage('dockerfile')).toBe('dockerfile')
    expect(canonicalLanguage('plaintext')).toBe('')
    expect(canonicalLanguage('nonexistent-lang')).toBe('')
    expect(canonicalLanguage(null)).toBe('')
  })
})
