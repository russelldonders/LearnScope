import { PANEL_BLOCKS, normaliseMediaUrl, normalisePageDocument, scoreTestQuestion, startingOrder } from '../lib/pageBuilder'
import { useEffect, useMemo, useState } from 'react'
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

// `panels` maps a LearnScope panel type (PANEL_BLOCKS) to the component that
// draws it, given `panelProps` too. Only an organisation's workspace pages
// pass it; anywhere else a panel block draws nothing.
export default function PageContent({ document, compact = false, onScore, panels = null, panelProps = null }) {
  const page = normalisePageDocument(document)
  const questions = useMemo(() => page.blocks.filter((block) => block.type === 'test_question'), [page])
  const questionKey = questions.map((question) => `${question.id}:${question.layout}:${question.items.map((item) => item.id).join(',')}`).join('|')
  const initialAnswers = () => Object.fromEntries(questions.map((question) => [question.id,
    question.layout === 'multiple' ? []
      : question.layout === 'matching' ? {}
        : question.layout === 'ordering' ? startingOrder(question.items, question.id)
          : '',
  ]))
  const [answers, setAnswers] = useState(initialAnswers)
  const [results, setResults] = useState({})
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [questionIndex, setQuestionIndex] = useState(0)

  useEffect(() => {
    setAnswers(initialAnswers())
    setResults({})
    setSubmitted(false)
    setSubmitError('')
    setQuestionIndex(0)
    // questionKey captures the structural identity of the test.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionKey])

  const isAnswered = (question) => question.layout === 'matching'
    ? question.items.every((item) => answers[question.id]?.[item.id])
    : Array.isArray(answers[question.id]) ? answers[question.id].length > 0 : String(answers[question.id] ?? '').trim() !== ''
  const answeredCount = questions.filter(isAnswered).length
  const allAnswered = questions.length > 0 && answeredCount === questions.length
  const earned = Object.values(results).reduce((sum, result) => sum + (result?.earned ?? 0), 0)
  const possible = questions.reduce((sum, question) => sum + question.points, 0)
  const percentage = possible ? Math.round((earned / possible) * 100) : 0
  const displayMode = page.test?.displayMode ?? 'all'

  async function submitTest() {
    if (!allAnswered || submitting) return
    const next = Object.fromEntries(questions.map((question) => [question.id, scoreTestQuestion(question, answers[question.id])]))
    const total = Object.values(next).reduce((sum, result) => sum + result.earned, 0)
    const score = possible ? Math.round((total / possible) * 100) : 0
    setSubmitting(true)
    setSubmitError('')
    try {
      await onScore?.({ score, passed: score >= page.test.passMark })
      setResults(next)
      setSubmitted(true)
    } catch (error) {
      setSubmitError(error?.message || 'Your result could not be saved. Try submitting again.')
    } finally {
      setSubmitting(false)
    }
  }

  function renderTest() {
    const visibleQuestions = displayMode === 'one_at_a_time' ? questions.slice(questionIndex, questionIndex + 1) : questions
    return (
      <section className="page-test" aria-label="Scored test">
        <div className="page-test__meta">
          <span>{questions.length} {questions.length === 1 ? 'question' : 'questions'}</span>
          <span>Pass mark: {page.test.passMark}%</span>
        </div>
        {displayMode === 'one_at_a_time' && <p className="page-test__position" aria-live="polite">Question {questionIndex + 1} of {questions.length}</p>}
        <div className="page-test__questions">
          {visibleQuestions.map((question) => <ScoredQuestion
            key={question.id}
            block={question}
            number={displayMode === 'all' ? questions.indexOf(question) + 1 : null}
            answer={answers[question.id]}
            onAnswer={(answer) => setAnswers((current) => ({ ...current, [question.id]: answer }))}
            submitted={submitted}
            result={results[question.id]}
          />)}
        </div>
        {displayMode === 'one_at_a_time' && (
          <div className="page-test__navigation">
            <button type="button" className="page-interactive__button page-interactive__button--quiet" disabled={questionIndex === 0} onClick={() => setQuestionIndex((current) => current - 1)}>Previous question</button>
            {questionIndex < questions.length - 1 && <button type="button" className="page-interactive__button" onClick={() => setQuestionIndex((current) => current + 1)}>Next question</button>}
          </div>
        )}
        {!submitted && (displayMode === 'all' || questionIndex === questions.length - 1) && (
          <div className="page-test__submit">
            <p>{answeredCount} of {questions.length} answered</p>
            <button type="button" className="page-interactive__button" disabled={!allAnswered || submitting} onClick={submitTest}>{submitting ? 'Submitting…' : 'Submit test'}</button>
          </div>
        )}
        {submitError && <p className="page-test__error" role="alert">{submitError}</p>}
        {submitted && <section className="page-test-summary" aria-live="polite"><p>Your test score</p><strong>{percentage}%</strong><span>{earned} of {possible} points. Pass mark: {page.test.passMark}%.</span><b className={percentage >= page.test.passMark ? 'is-passed' : 'is-failed'}>{percentage >= page.test.passMark ? 'Passed' : 'Not passed'}</b></section>}
      </section>
    )
  }

  let testRendered = false
  return (
    <article className={`page-content mx-auto w-full ${compact ? 'max-w-3xl' : 'max-w-[70ch]'}`}>
      {page.blocks.map((block) => {
        if (block.type === 'test_question') {
          if (testRendered) return null
          testRendered = true
          return <div key="scored-test">{renderTest()}</div>
        }
        if (PANEL_BLOCKS[block.type]) {
          const Panel = panels?.[block.type]
          return Panel ? <Panel key={block.id} block={block} {...panelProps} /> : null
        }
        const Interactive = INTERACTIVE_COMPONENTS[block.type]
        if (Interactive) return block.items.length > 0 ? <Interactive key={block.id} block={block} /> : null
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
