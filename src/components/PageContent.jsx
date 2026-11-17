import { normaliseMediaUrl, normalisePageDocument } from '../lib/pageBuilder'
import { useMemo, useState } from 'react'
import { Accordion, Animation, Chart, Diagram, FlipCards, Hotspots, KnowledgeCheck, Ordering, ScoredQuestion } from './PageInteractiveBlocks'

const INTERACTIVE_COMPONENTS = {
  knowledge_check: KnowledgeCheck,
  test_question: ScoredQuestion,
  flip_cards: FlipCards,
  hotspots: Hotspots,
  accordion: Accordion,
  ordering: Ordering,
  chart: Chart,
  diagram: Diagram,
  animation: Animation,
}

function RichText({ html, className = '' }) {
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />
}

const HEADING_CLASS = { 1: 'page-heading', 2: 'page-subheading', 3: 'page-subheading page-subheading--sm' }
const ALIGN_CLASS = { left: '', center: 'page-align-center', right: 'page-align-right' }

export default function PageContent({ document, compact = false, onScore }) {
  const page = normalisePageDocument(document)
  const questions = useMemo(() => page.blocks.filter((block) => block.type === 'test_question'), [page])
  const [results, setResults] = useState({})
  const allMarked = questions.length > 0 && questions.every((question) => results[question.id])
  const earned = Object.values(results).reduce((sum, result) => sum + (result?.earned ?? 0), 0)
  const possible = questions.reduce((sum, question) => sum + question.points, 0)
  const percentage = possible ? Math.round((earned / possible) * 100) : 0
  function recordResult(id, result) {
    setResults((current) => {
      const next = { ...current }
      if (result) next[id] = result
      else delete next[id]
      const complete = questions.length > 0 && questions.every((question) => next[question.id])
      if (complete) {
        const total = Object.values(next).reduce((sum, value) => sum + value.earned, 0)
        const percent = possible ? Math.round((total / possible) * 100) : 0
        onScore?.({ score: percent, passed: percent >= page.test.passMark })
      }
      return next
    })
  }
  return (
    <article className={`page-content mx-auto w-full ${compact ? 'max-w-3xl' : 'max-w-[70ch]'}`}>
      {page.blocks.map((block) => {
        const Interactive = INTERACTIVE_COMPONENTS[block.type]
        if (Interactive) return block.items.length > 0 ? <Interactive key={block.id} block={block} onResult={block.type === 'test_question' ? (result) => recordResult(block.id, result) : undefined} /> : null
        if (block.type === 'heading') {
          return (
            <RichText
              key={block.id}
              html={block.content}
              className={`${HEADING_CLASS[block.level]} ${ALIGN_CLASS[block.align]}`}
            />
          )
        }
        if (block.type === 'callout') {
          return (
            <RichText
              key={block.id}
              html={block.content}
              className={`page-callout page-callout--${block.variant} ${ALIGN_CLASS[block.align]}`}
            />
          )
        }
        if (block.type === 'quote') {
          return <RichText key={block.id} html={block.content} className={`page-quote ${ALIGN_CLASS[block.align]}`} />
        }
        if (block.type === 'divider') return <hr key={block.id} className="page-divider" />
        if (block.type === 'columns') {
          return (
            <div key={block.id} className="page-columns">
              <RichText html={block.content} />
              <RichText html={block.secondaryContent} />
            </div>
          )
        }
        if (block.type === 'image') return <PageMedia key={block.id} block={block} />
        if (block.type === 'video') return <PageMedia key={block.id} block={block} />
        return <RichText key={block.id} html={block.content} className={`page-paragraph ${ALIGN_CLASS[block.align]}`} />
      })}
      {allMarked && <section className="page-test-summary" aria-live="polite"><p>Your test score</p><strong>{percentage}%</strong><span>{earned} of {possible} points. Pass mark: {page.test.passMark}%.</span><b className={percentage >= page.test.passMark ? 'is-passed' : 'is-failed'}>{percentage >= page.test.passMark ? 'Passed' : 'Not passed yet'}</b></section>}
    </article>
  )
}

export function PageMedia({ block }) {
  const url = normaliseMediaUrl(block.url, block.type)
  if (!url) return null
  const isEmbed = /^(https:\/\/www\.youtube\.com\/embed\/|https:\/\/player\.vimeo\.com\/video\/)/.test(url)
  return (
    <figure className={`page-media page-media--${block.size || 'full'}`}>
      {block.type === 'image' ? (
        <img src={url} alt={block.alt} loading="lazy" />
      ) : isEmbed ? (
        <iframe src={url} title={block.alt || block.caption || 'Embedded video'} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
      ) : (
        <video src={url} controls preload="metadata" aria-label={block.alt || block.caption || 'Video'} />
      )}
      {block.caption && <figcaption>{block.caption}</figcaption>}
    </figure>
  )
}
