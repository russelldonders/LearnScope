export const EMPTY_PAGE_DOCUMENT = {
  version: 1,
  blocks: [
    { id: crypto.randomUUID(), type: 'heading', level: 1, content: 'Page title' },
    { id: crypto.randomUUID(), type: 'text', content: 'Start writing here…' },
  ],
}

const ALLOWED_TAGS = new Set(['STRONG', 'B', 'EM', 'I', 'U', 'BR', 'A'])

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

export function normalisePageDocument(document) {
  const blocks = Array.isArray(document?.blocks) ? document.blocks : []
  return {
    version: 1,
    blocks: blocks.slice(0, 100).map((block) => ({
      id: String(block.id || crypto.randomUUID()),
      type: ['heading', 'text', 'callout', 'divider', 'columns'].includes(block.type) ? block.type : 'text',
      ...(block.type === 'heading' ? { level: block.level === 2 ? 2 : 1 } : {}),
      ...(block.type !== 'divider' ? { content: sanitiseRichText(block.content || '') } : {}),
      ...(block.type === 'columns' ? { secondaryContent: sanitiseRichText(block.secondaryContent || '') } : {}),
    })),
  }
}
