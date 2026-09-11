import { describe, expect, it } from 'vitest'
import { normaliseMediaUrl, normalisePageDocument, pageDocumentWordCount, sanitiseRichText } from './pageBuilder'

describe('page builder content', () => {
  it('keeps supported formatting and removes executable markup', () => {
    expect(sanitiseRichText('<strong>Safe</strong><img src=x onerror=alert(1)><script>bad()</script>')).toBe(
      '<strong>Safe</strong>bad()'
    )
  })

  it('normalises unknown blocks to safe text blocks', () => {
    const result = normalisePageDocument({ version: 99, blocks: [{ id: 'one', type: 'embed', content: '<b>Hi</b>' }] })
    expect(result).toEqual({ version: 1, blocks: [{ id: 'one', type: 'text', content: '<b>Hi</b>' }] })
  })

  it('normalises supported video links and rejects executable URLs', () => {
    expect(normaliseMediaUrl('https://youtu.be/abc123', 'video')).toBe('https://www.youtube.com/embed/abc123')
    expect(normaliseMediaUrl('/course-content/org-1/page-media/image.png', 'image')).toBe('/course-content/org-1/page-media/image.png')
    expect(normaliseMediaUrl('/course-content/org-1/page-media/../secret.png', 'image')).toBe('')
    expect(normaliseMediaUrl('javascript:alert(1)', 'image')).toBe('')
  })

  it('accepts an existing library resource\'s own storage path (picked via "Choose from library")', () => {
    const path = '/course-content/org-1/8b6e9e0e-1c2b-4a3d-9f3a-000000000001/My Recording (final).mp4'
    expect(normaliseMediaUrl(path, 'video')).toBe(path)
    // Still no traversing out of that resource's own path via the filename segment.
    expect(normaliseMediaUrl('/course-content/org-1/8b6e9e0e-1c2b-4a3d-9f3a-000000000001/../secret.mp4', 'video')).toBe('')
  })

  it('keeps list and strikethrough markup (needed for the format bar\'s list/strike buttons)', () => {
    expect(sanitiseRichText('<ul><li>One</li><li>Two</li></ul><strike>gone</strike>')).toBe(
      '<ul><li>One</li><li>Two</li></ul><strike>gone</strike>'
    )
  })

  it('accepts a third heading level and defaults alignment/variant/size for well-formed blocks', () => {
    const result = normalisePageDocument({
      blocks: [
        { id: 'h', type: 'heading', level: 3, content: 'Hi' },
        { id: 'q', type: 'quote', content: 'Said someone' },
        { id: 'c', type: 'callout', content: 'Note', variant: 'warning' },
        { id: 'i', type: 'image', url: 'https://example.com/a.png', size: 'small' },
      ],
    })
    expect(result.blocks[0]).toMatchObject({ level: 3, align: 'left' })
    expect(result.blocks[1]).toMatchObject({ type: 'quote', align: 'left' })
    expect(result.blocks[2]).toMatchObject({ variant: 'warning', align: 'left' })
    expect(result.blocks[3]).toMatchObject({ size: 'small' })
  })

  it('rejects an out-of-range heading level and unknown variant/size/align', () => {
    const result = normalisePageDocument({
      blocks: [
        { id: 'h', type: 'heading', level: 7, content: 'Hi' },
        { id: 'c', type: 'callout', content: 'Note', variant: 'sparkly', align: 'diagonal' },
        { id: 'i', type: 'image', url: 'https://example.com/a.png', size: 'huge' },
      ],
    })
    expect(result.blocks[0].level).toBe(1)
    expect(result.blocks[1].variant).toBe('info')
    expect(result.blocks[1].align).toBe('left')
    expect(result.blocks[2].size).toBe('full')
  })

  it('counts words across text and media captions, ignoring markup', () => {
    const count = pageDocumentWordCount({
      blocks: [
        { id: 'h', type: 'heading', level: 1, content: 'A short title' },
        { id: 't', type: 'text', content: '<ul><li>One item</li><li>Another one</li></ul>' },
        { id: 'i', type: 'image', url: 'https://example.com/a.png', caption: 'A photo of a cat' },
      ],
    })
    expect(count).toBe(3 + 4 + 5)
  })
})
