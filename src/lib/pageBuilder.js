export const EMPTY_PAGE_DOCUMENT = {
  version: 1,
  blocks: [
    { id: crypto.randomUUID(), type: 'heading', level: 1, content: 'Page title' },
    { id: crypto.randomUUID(), type: 'text', content: 'Start writing here…' },
  ],
}

// Interactive and visual blocks: plain-text title and items, drawn by
// LearnScope (never raw HTML or AI-written graphics). Answers to the
// interactive ones are formative -- feedback only, never saved.
//   title    the question, prompt or heading
//   layout   how it's drawn (see BLOCK_LAYOUTS)
//   items    [{ id, label, detail, value, correct }] -- which fields matter
//            depends on the type (see INTERACTIVE_BLOCKS)
//   caption  a note under it (a chart's "Illustrative example", ordering
//            feedback)
//   unit     a chart's unit
export const INTERACTIVE_BLOCKS = {
  knowledge_check: { label: 'Knowledge check', minItems: 2, maxItems: 6 },
  test_question: { label: 'Scored question', minItems: 1, maxItems: 12 },
  flip_cards: { label: 'Flip cards', minItems: 1, maxItems: 8 },
  hotspots: { label: 'Hotspots', minItems: 2, maxItems: 8 },
  accordion: { label: 'Reveal sections', minItems: 1, maxItems: 8 },
  ordering: { label: 'Put in order', minItems: 2, maxItems: 7 },
  chart: { label: 'Chart', minItems: 1, maxItems: 12 },
  diagram: { label: 'Diagram', minItems: 2, maxItems: 8 },
  animation: { label: 'Animated explainer', minItems: 2, maxItems: 8 },
}
export const BLOCK_LAYOUTS = {
  knowledge_check: ['single', 'multiple'],
  test_question: ['single', 'multiple', 'true_false', 'short_text', 'number', 'ordering', 'matching'],
  chart: ['bar', 'line', 'pie'],
  diagram: ['flow', 'cycle', 'hub', 'comparison'],
  hotspots: ['flow', 'cycle', 'hub', 'grid'],
  animation: ['flow', 'cycle', 'build'],
}

export const BLOCK_TYPES = ['heading', 'text', 'callout', 'quote', 'divider', 'columns', 'image', 'video', ...Object.keys(INTERACTIVE_BLOCKS)]

const PLAIN_TEXT_LIMITS = { title: 300, label: 300, detail: 1200, caption: 500, unit: 30 }

// Interactive blocks hold plain text only: any markup is stripped, and it's
// always shown as text.
export function plainText(value, limit) {
  const withoutTags = String(value ?? '').replace(/<[^>]*>/g, '')
  // Control characters out, keeping tabs and line breaks.
  const printable = [...withoutTags].filter((character) => {
    const code = character.charCodeAt(0)
    return code >= 32 || code === 9 || code === 10 || code === 13
  }).join('')
  return printable.trim().slice(0, limit)
}

function normaliseInteractive(block) {
  const spec = INTERACTIVE_BLOCKS[block.type]
  const layouts = BLOCK_LAYOUTS[block.type]
  const items = (Array.isArray(block.items) ? block.items : []).slice(0, spec.maxItems).map((item) => ({
    id: String(item?.id || crypto.randomUUID()),
    label: plainText(item?.label, PLAIN_TEXT_LIMITS.label),
    detail: plainText(item?.detail, PLAIN_TEXT_LIMITS.detail),
    value: Number.isFinite(Number(item?.value)) ? Number(item.value) : 0,
    correct: item?.correct === true,
  }))
  return {
    title: plainText(block.title, PLAIN_TEXT_LIMITS.title),
    ...(layouts ? { layout: layouts.includes(block.layout) ? block.layout : layouts[0] } : {}),
    items,
    caption: plainText(block.caption, PLAIN_TEXT_LIMITS.caption),
    ...(block.type === 'test_question' ? {
      points: Math.max(1, Math.min(100, Number.isFinite(Number(block.points)) ? Number(block.points) : 1)),
      tolerance: Math.max(0, Math.min(1000000, Number.isFinite(Number(block.tolerance)) ? Number(block.tolerance) : 0)),
    } : {}),
    ...(block.type === 'chart' ? { unit: plainText(block.unit, PLAIN_TEXT_LIMITS.unit) } : {}),
  }
}
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
        // Clean the subtree before unwrapping it: the children being hoisted
        // aren't in this loop's snapshot, so they'd otherwise skip cleaning
        // entirely (e.g. <span><img onerror=…></span>).
        clean(child)
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

// The middle segment matches either page-media's own uploads (literally
// "page-media") or an existing library resource's storage path (its item
// id, a UUID) -- picking an existing video/screen-recording resource from
// the library (MediaEditor's "Choose from library") points a block
// straight at that resource's own file rather than copying it, so this has
// to accept both shapes. No "/" allowed in either segment, so a traversal
// attempt embedded in the final one (e.g. "../secret.png") can never match
// as a single segment -- see pageBuilder.test.js.
export function normaliseMediaUrl(value = '', type = 'image') {
  const rawValue = String(value).trim()
  if (/^\/course-content\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+\/[^/]+$/.test(rawValue)) return rawValue
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
  const normalised = {
    version: 1,
    blocks: blocks.slice(0, 100).map((block) => INTERACTIVE_BLOCKS[block.type] ? {
      id: String(block.id || crypto.randomUUID()),
      type: block.type,
      ...normaliseInteractive(block),
    } : {
      id: String(block.id || crypto.randomUUID()),
      type: BLOCK_TYPES.includes(block.type) ? block.type : 'text',
      ...(block.type === 'heading' ? { level: [1, 2, 3].includes(block.level) ? block.level : 1 } : {}),
      ...(block.type !== 'divider' ? { content: sanitiseRichText(block.content || '') } : {}),
      ...(block.type === 'columns' ? { secondaryContent: sanitiseRichText(block.secondaryContent || '') } : {}),
      ...(ALIGNABLE_TYPES.has(block.type) ? { align: TEXT_ALIGNMENTS.includes(block.align) ? block.align : 'left' } : {}),
      ...(block.type === 'callout' ? { variant: CALLOUT_VARIANTS.includes(block.variant) ? block.variant : 'info' } : {}),
      ...(['image', 'video'].includes(block.type) ? {
        url: normaliseMediaUrl(block.url, block.type),
        storagePath: /^[-a-zA-Z0-9]+\/[-a-zA-Z0-9]+\/[^/]+$/.test(block.storagePath || '') ? block.storagePath : '',
        alt: String(block.alt || '').slice(0, 300),
        caption: String(block.caption || '').slice(0, 500),
        size: MEDIA_SIZES.includes(block.size) ? block.size : 'full',
      } : {}),
    }),
  }
  if (normalised.blocks.some((block) => block.type === 'test_question')) {
    normalised.test = {
      passMark: Math.max(0, Math.min(100, Number.isFinite(Number(document?.test?.passMark)) ? Number(document.test.passMark) : 70)),
      displayMode: document?.test?.displayMode === 'one_at_a_time' ? 'one_at_a_time' : 'all',
    }
  }
  return normalised
}

export function pageHasScoredTest(document) {
  return normalisePageDocument(document).blocks.some((block) => block.type === 'test_question')
}

function sameValues(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index])
}

// Pure scoring keeps the learner UI and its tests honest. A question earns
// all of its points or none; the page-level test combines weighted results.
export function scoreTestQuestion(block, answer) {
  const question = normalisePageDocument({ blocks: [block] }).blocks[0]
  if (question?.type !== 'test_question') return { earned: 0, possible: 0, correct: false }
  const points = question.points
  const correctIds = question.items.filter((item) => item.correct).map((item) => item.id).sort()
  let correct = false
  if (question.layout === 'single' || question.layout === 'multiple' || question.layout === 'true_false') {
    const chosen = (Array.isArray(answer) ? answer : [answer]).filter(Boolean).map(String).sort()
    correct = sameValues(chosen, correctIds)
  } else if (question.layout === 'short_text') {
    const accepted = question.items.map((item) => item.label.trim().toLocaleLowerCase()).filter(Boolean)
    correct = accepted.includes(String(answer ?? '').trim().toLocaleLowerCase())
  } else if (question.layout === 'number') {
    const expected = Number(question.items[0]?.value)
    const actual = Number(answer)
    correct = Number.isFinite(actual) && Math.abs(actual - expected) <= question.tolerance
  } else if (question.layout === 'ordering') {
    correct = sameValues(Array.isArray(answer) ? answer.map(String) : [], question.items.map((item) => item.id))
  } else if (question.layout === 'matching') {
    correct = question.items.every((item) => String(answer?.[item.id] ?? '') === item.detail)
  }
  return { earned: correct ? points : 0, possible: points, correct }
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
    .flatMap((block) => [
      block.content, block.secondaryContent, block.caption, block.title,
      ...(block.items ?? []).flatMap((item) => [item.label, item.detail]),
    ].filter(Boolean))
    .map((html) => new DOMParser().parseFromString(html.replace(/<(li|br|p|div)[^>]*>/gi, ' '), 'text/html').body.textContent || '')
    .join(' ')
  return (text.match(/\S+/g) || []).length
}

// A new block of one of these types, with enough to show what it does.
export function newInteractiveBlock(type) {
  const item = (label, detail = '', extra = {}) => ({ id: crypto.randomUUID(), label, detail, value: 0, correct: false, ...extra })
  const base = { id: crypto.randomUUID(), type, title: '', caption: '' }
  switch (type) {
    case 'knowledge_check':
      return { ...base, title: 'Your question', layout: 'single', items: [item('Right answer', 'Why this is right.', { correct: true }), item('Another answer', 'Why this isn’t right.')] }
    case 'test_question':
      return { ...base, title: 'Your scored question', layout: 'single', points: 1, tolerance: 0, items: [item('Right answer', '', { correct: true }), item('Another answer')] }
    case 'flip_cards':
      return { ...base, items: [item('Term', 'What it means.'), item('Another term', 'What it means.')] }
    case 'hotspots':
      return { ...base, title: 'Explore the parts', layout: 'hub', items: [item('Centre', 'What this is.'), item('Part one', 'What this does.'), item('Part two', 'What this does.')] }
    case 'accordion':
      return { ...base, items: [item('First section', 'More detail.'), item('Second section', 'More detail.')] }
    case 'ordering':
      return { ...base, title: 'Put these steps in order', items: [item('First step'), item('Second step'), item('Third step')] }
    case 'chart':
      return { ...base, title: 'Chart title', layout: 'bar', unit: '', caption: 'Illustrative example', items: [item('A', '', { value: 3 }), item('B', '', { value: 5 }), item('C', '', { value: 2 })] }
    case 'diagram':
      return { ...base, title: 'How it fits together', layout: 'flow', items: [item('Start'), item('Then'), item('Finally')] }
    case 'animation':
    default:
      return { ...base, title: 'How it works', layout: 'flow', items: [item('Step one', 'What happens first.'), item('Step two', 'What happens next.'), item('Step three', 'How it ends.')] }
  }
}

// The same mixed-up order every time for a given block, never already right.
export function startingOrder(items, seed) {
  const ids = items.map((item) => item.id)
  if (ids.length < 2) return ids
  let hash = 0
  for (const character of String(seed)) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  const shuffled = [...ids]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    hash = (hash * 1103515245 + 12345) >>> 0
    const swap = hash % (index + 1)
    ;[shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]]
  }
  if (shuffled.every((id, index) => id === ids[index])) shuffled.push(shuffled.shift())
  return shuffled
}
