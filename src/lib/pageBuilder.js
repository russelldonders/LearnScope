export const EMPTY_PAGE_DOCUMENT = {
  version: 1,
  blocks: [
    { id: crypto.randomUUID(), type: 'heading', level: 1, content: 'Page title' },
    { id: crypto.randomUUID(), type: 'text', content: 'Start writing here…' },
  ],
}

export const BLOCK_TYPES = ['heading', 'text', 'callout', 'quote', 'divider', 'columns', 'image', 'video']
export const CALLOUT_VARIANTS = ['info', 'warning', 'success', 'tip']
export const MEDIA_SIZES = ['small', 'medium', 'large', 'full']
export const TEXT_ALIGNMENTS = ['left', 'center', 'right']
// Block types whose `content` is free-form rich text a learner reads inline
// -- alignment is meaningful on these, not on divider/image/video/columns
// (columns keeps each side left-aligned; a wider per-column alignment control
// isn't worth the extra UI for how rarely it'd be used).
const ALIGNABLE_TYPES = new Set(['heading', 'text', 'callout', 'quote'])

const ALLOWED_TAGS = new Set(['STRONG', 'B', 'EM', 'I', 'U', 'STRIKE', 'S', 'BR', 'A', 'UL', 'OL', 'LI'])

export function sanitiseRichText(value = '') {
  if (typeof DOMParser === 'undefined') return String(value).replace(/<[^>]*>/g, '')
  const document = new DOMParser().parseFromString(`<div>${value}</div>`, 'text/html')
  const root = document.body.firstElementChild

  function clean(node) {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.COMMENT_NODE) {
        child.remove()
        continue
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue
      if (!ALLOWED_TAGS.has(child.tagName)) {
        child.replaceWith(...child.childNodes)
        continue
      }
      if (child.tagName === 'A') {
        const href = child.getAttribute('href') || ''
        if (!/^https?:\/\//i.test(href)) child.removeAttribute('href')
        else {
          child.setAttribute('target', '_blank')
          child.setAttribute('rel', 'noopener noreferrer')
        }
      }
      for (const attribute of [...child.attributes]) {
        if (child.tagName !== 'A' || !['href', 'target', 'rel'].includes(attribute.name)) {
          child.removeAttribute(attribute.name)
        }
      }
      clean(child)
    }
  }

  clean(root)
  return root.innerHTML
}

export function normaliseMediaUrl(value = '', type = 'image') {
  const rawValue = String(value).trim()
  if (/^\/course-content\/[a-zA-Z0-9-]+\/page-media\/[a-zA-Z0-9._-]+$/.test(rawValue)) return rawValue
  let parsed
  try {
    parsed = new URL(rawValue)
  } catch {
    return ''
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return ''
  if (type !== 'video') return parsed.href

  const host = parsed.hostname.replace(/^www\./, '')
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    const id = parsed.pathname === '/watch' ? parsed.searchParams.get('v') : parsed.pathname.match(/^\/(?:embed|shorts)\/([^/?]+)/)?.[1]
    return id ? `https://www.youtube.com/embed/${id}` : ''
  }
  if (host === 'youtu.be') {
    const id = parsed.pathname.slice(1)
    return id ? `https://www.youtube.com/embed/${id}` : ''
  }
  if (host === 'vimeo.com') {
    const id = parsed.pathname.match(/^\/(\d+)/)?.[1]
    return id ? `https://player.vimeo.com/video/${id}` : ''
  }
  if (host === 'player.vimeo.com' && /^\/video\/\d+/.test(parsed.pathname)) return parsed.href
  return parsed.href
}

export function normalisePageDocument(document) {
  const blocks = Array.isArray(document?.blocks) ? document.blocks : []
  return {
    version: 1,
    blocks: blocks.slice(0, 100).map((block) => ({
      id: String(block.id || crypto.randomUUID()),
      type: BLOCK_TYPES.includes(block.type) ? block.type : 'text',
      ...(block.type === 'heading' ? { level: [1, 2, 3].includes(block.level) ? block.level : 1 } : {}),
      ...(block.type !== 'divider' ? { content: sanitiseRichText(block.content || '') } : {}),
      ...(block.type === 'columns' ? { secondaryContent: sanitiseRichText(block.secondaryContent || '') } : {}),
      ...(ALIGNABLE_TYPES.has(block.type) ? { align: TEXT_ALIGNMENTS.includes(block.align) ? block.align : 'left' } : {}),
      ...(block.type === 'callout' ? { variant: CALLOUT_VARIANTS.includes(block.variant) ? block.variant : 'info' } : {}),
      ...(['image', 'video'].includes(block.type) ? {
        url: normaliseMediaUrl(block.url, block.type),
        storagePath: /^[-a-zA-Z0-9]+\/page-media\/[a-zA-Z0-9._-]+$/.test(block.storagePath || '') ? block.storagePath : '',
        alt: String(block.alt || '').slice(0, 300),
        caption: String(block.caption || '').slice(0, 500),
        size: MEDIA_SIZES.includes(block.size) ? block.size : 'full',
      } : {}),
    })),
  }
}

// Plain-text length of every block's rich text, used for the editor's word
// count/reading-time indicator -- strips tags rather than reusing
// sanitiseRichText's DOM output directly since list markup (<li>) should
// still count as separate words, which innerText-style whitespace joining
// handles better than raw textContent on adjacent inline tags.
export function pageDocumentWordCount(document) {
  if (typeof DOMParser === 'undefined') return 0
  const page = normalisePageDocument(document)
  const text = page.blocks
    .flatMap((block) => [block.content, block.secondaryContent, block.caption].filter(Boolean))
    .map((html) => new DOMParser().parseFromString(html.replace(/<(li|br|p|div)[^>]*>/gi, ' '), 'text/html').body.textContent || '')
    .join(' ')
  return (text.match(/\S+/g) || []).length
}
