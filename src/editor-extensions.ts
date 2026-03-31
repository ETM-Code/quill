import { type AnyExtension, type Extension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import Placeholder from '@tiptap/extension-placeholder'
import Typography from '@tiptap/extension-typography'
import { Mathematics } from '@tiptap/extension-mathematics'
import { TableKit } from '@tiptap/extension-table'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { QuillImage } from './image-extension'

const katexMacros = {
  '\\R': '\\mathbb{R}',
  '\\N': '\\mathbb{N}',
  '\\Z': '\\mathbb{Z}',
  '\\Q': '\\mathbb{Q}',
  '\\C': '\\mathbb{C}',
}

export function buildExtensions(input: {
  codeBlockLowlightExtension: Extension | null
  uiMenuExtensions: { bubbleMenu: Extension; floatingMenu: Extension } | null
  onInlineMathClick: (node: any, pos: number) => void
  onBlockMathClick: (node: any, pos: number) => void
  extraExtensions?: Extension[]
}) {
  const extensions: AnyExtension[] = [
    StarterKit.configure({
      codeBlock: input.codeBlockLowlightExtension ? false : undefined,
    }),
    Markdown,
    Placeholder.configure({
      placeholder: 'Start writing...',
    }),
    Typography,
    TaskList,
    TaskItem.configure({
      nested: true,
    }),
    QuillImage,
    TableKit.configure({
      table: {
        renderWrapper: true,
      },
    }),
    Mathematics.configure({
      inlineOptions: {
        onClick: input.onInlineMathClick,
      },
      blockOptions: {
        onClick: input.onBlockMathClick,
      },
      katexOptions: {
        throwOnError: false,
        macros: katexMacros,
      },
    }),
  ]

  if (input.codeBlockLowlightExtension) {
    extensions.splice(1, 0, input.codeBlockLowlightExtension)
  }

  if (input.uiMenuExtensions) {
    extensions.push(input.uiMenuExtensions.bubbleMenu, input.uiMenuExtensions.floatingMenu)
  }

  if (input.extraExtensions?.length) {
    extensions.push(...input.extraExtensions)
  }

  return extensions
}
