// Quill's markdown codec: markdown-it in, a prosemirror-markdown style writer
// out, with unedited source preserved byte for byte. See docs/markdown-engine.md.
import type { Node as PMNode, Schema } from '@tiptap/pm/model'
import { MarkdownParser, type ParseResult } from './parse'
import { serializeDoc, serializeFragment, type SerializeOptions } from './serialize'
import type { LoadInfo } from './source'

export interface MarkdownCodec {
  parser: MarkdownParser
  parse(markdown: string): ParseResult
  /** Serialize a document. `load` = the LoadInfo of the file it was opened from. */
  serialize(doc: PMNode, opts?: Omit<SerializeOptions, 'linkify'>): string
  serializeFragment(doc: PMNode, opts?: Omit<SerializeOptions, 'linkify'>): string
}

const codecs = new WeakMap<Schema, MarkdownCodec>()

export function getCodec(schema: Schema): MarkdownCodec {
  let codec = codecs.get(schema)
  if (!codec) {
    const parser = new MarkdownParser(schema)
    const linkify = parser.md.linkify
    codec = {
      parser,
      parse: md => parser.parse(md),
      serialize: (doc, opts = {}) => serializeDoc(doc, { ...opts, linkify }),
      serializeFragment: (doc, opts = {}) => serializeFragment(doc, { ...opts, linkify }),
    }
    codecs.set(schema, codec)
  }
  return codec
}

export type { LoadInfo, ParseResult }
