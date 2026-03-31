import { mergeAttributes, Node } from '@tiptap/core'
import { normalizeImageAttrs, renderImageMarkdown, type ImageAttrs } from './image-support'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    quillImage: {
      setImage: (attrs: ImageAttrs) => ReturnType
    }
  }
}

export const QuillImage = Node.create({
  name: 'image',

  group: 'block',

  draggable: true,

  atom: true,

  addAttributes() {
    return {
      src: {
        default: null,
      },
      alt: {
        default: null,
      },
      title: {
        default: null,
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'img[src]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes)]
  },

  markdownTokenName: 'image',

  parseMarkdown: (token, helpers) => {
    return helpers.createNode('image', {
      src: token.src,
      alt: token.alt || null,
      title: token.title || null,
    })
  },

  renderMarkdown: node => renderImageMarkdown(node),

  addCommands() {
    return {
      setImage:
        attrs =>
        ({ commands }) => {
          const normalized = normalizeImageAttrs(attrs)
          if (!normalized) {
            return false
          }

          return commands.insertContent({
            type: this.name,
            attrs: normalized,
          })
        },
    }
  },
})
