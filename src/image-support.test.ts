import { describe, expect, mock, test } from 'bun:test'
import { applyImageInsert, normalizeImageAttrs, renderImageMarkdown } from './image-support'

describe('normalizeImageAttrs', () => {
  test('trims src and optional fields', () => {
    expect(
      normalizeImageAttrs({
        src: '  https://example.com/cat.png  ',
        alt: '  Cat  ',
        title: '  A cat  ',
      }),
    ).toEqual({
      src: 'https://example.com/cat.png',
      alt: 'Cat',
      title: 'A cat',
    })
  })

  test('returns null when src is empty', () => {
    expect(
      normalizeImageAttrs({
        src: '   ',
        alt: 'Cat',
      }),
    ).toBeNull()
  })

  test('drops blank optional fields', () => {
    expect(
      normalizeImageAttrs({
        src: '/tmp/cat.png',
        alt: '   ',
        title: '',
      }),
    ).toEqual({
      src: '/tmp/cat.png',
      alt: null,
      title: null,
    })
  })
})

describe('applyImageInsert', () => {
  test('inserts an image when prompts are valid', () => {
    const setImage = mock(() => true)

    expect(
      applyImageInsert(
        { setImage },
        {
          src: ' https://example.com/dog.jpg ',
          alt: ' Dog ',
          title: ' Good dog ',
        },
      ),
    ).toBe(true)

    expect(setImage).toHaveBeenCalledWith({
      src: 'https://example.com/dog.jpg',
      alt: 'Dog',
      title: 'Good dog',
    })
  })

  test('does not insert when src is missing', () => {
    const setImage = mock(() => true)

    expect(
      applyImageInsert(
        { setImage },
        {
          src: '   ',
          alt: 'Dog',
          title: null,
        },
      ),
    ).toBe(false)

    expect(setImage).not.toHaveBeenCalled()
  })
})

describe('renderImageMarkdown', () => {
  test('renders markdown image syntax with alt text and title', () => {
    expect(
      renderImageMarkdown({
        attrs: {
          src: 'https://example.com/bird.png',
          alt: 'Bird',
          title: 'Flying',
        },
      }),
    ).toBe('![Bird](https://example.com/bird.png "Flying")')
  })

  test('renders markdown image syntax without optional text', () => {
    expect(
      renderImageMarkdown({
        attrs: {
          src: 'images/bird.png',
          alt: null,
          title: null,
        },
      }),
    ).toBe('![](images/bird.png)')
  })
})
