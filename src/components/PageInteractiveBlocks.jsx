import { useEffect, useId, useMemo, useState } from 'react'
import { useOptionalLanguage } from '../context/LanguageContext'
import { startingOrder } from '../lib/pageBuilder'

// The interactive and visual blocks a learner sees on a course page (see
// INTERACTIVE_BLOCKS in lib/pageBuilder.js). Everything is plain text drawn
// by LearnScope. Answers are formative: feedback is instant and nothing is
// saved.

const SERIES_COLOURS = ['var(--color-moss)', 'var(--color-gold)', 'var(--color-slate)', '#b5523b', '#6b7f3a', '#8a6fb0', '#3f7f8c', '#c08a2e']

function BlockFrame({ title, caption, children, className = '' }) {
  return (
    <section className={`page-interactive ${className}`}>
      {title && <p className="page-interactive__title">{title}</p>}
      {children}
      {caption && <p className="page-interactive__caption">{caption}</p>}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Knowledge check
// ---------------------------------------------------------------------------

export function KnowledgeCheck({ block }) {
  const { t } = useOptionalLanguage()
  const multiple = block.layout === 'multiple'
  const name = useId()
  const [chosen, setChosen] = useState([])
  const [checked, setChecked] = useState(false)
  const correctIds = block.items.filter((item) => item.correct).map((item) => item.id)
  const allRight = checked
    && chosen.length === correctIds.length
    && chosen.every((id) => correctIds.includes(id))

  function choose(id) {
    if (checked) return
    setChosen((current) => multiple
      ? (current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
      : [id])
  }

  return (
    <BlockFrame className="page-check" caption={block.caption}>
      <fieldset>
        <legend className="page-interactive__title">{block.title}</legend>
        <p className="page-interactive__hint">{multiple ? t('pageBlocks.chooseAll') : t('pageBlocks.chooseOne')}</p>
        <div className="page-check__options">
          {block.items.map((item) => {
            const isChosen = chosen.includes(item.id)
            const state = !checked ? '' : item.correct ? 'is-correct' : isChosen ? 'is-wrong' : ''
            return (
              <label key={item.id} className={`page-check__option ${isChosen ? 'is-chosen' : ''} ${state}`}>
                <input
                  type={multiple ? 'checkbox' : 'radio'}
                  name={name}
                  checked={isChosen}
                  disabled={checked}
                  onChange={() => choose(item.id)}
                />
                <span>
                  {item.label}
                  {checked && (isChosen || item.correct) && item.detail && (
                    <span className="page-check__feedback">{item.detail}</span>
                  )}
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>
      <div className="page-interactive__actions">
        {!checked ? (
          <button type="button" className="page-interactive__button" disabled={chosen.length === 0} onClick={() => setChecked(true)}>
            {t('pageBlocks.checkAnswer')}
          </button>
        ) : (
          <>
            <p role="status" className={`page-interactive__result ${allRight ? 'is-correct' : 'is-wrong'}`}>
              {allRight ? t('pageBlocks.correct') : t('pageBlocks.notQuite')}
            </p>
            <button type="button" className="page-interactive__button page-interactive__button--quiet" onClick={() => { setChecked(false); setChosen([]) }}>
              {t('pageBlocks.tryAgain')}
            </button>
          </>
        )}
      </div>
    </BlockFrame>
  )
}

// ---------------------------------------------------------------------------
// Flip cards
// ---------------------------------------------------------------------------

export function FlipCards({ block }) {
  const { t } = useOptionalLanguage()
  const [flipped, setFlipped] = useState([])
  return (
    <BlockFrame title={block.title} caption={block.caption}>
      <p className="page-interactive__hint">{t('pageBlocks.flipHint')}</p>
      <ul className="page-flip-cards">
        {block.items.map((item) => {
          const isFlipped = flipped.includes(item.id)
          return (
            <li key={item.id}>
              <button
                type="button"
                aria-pressed={isFlipped}
                aria-label={isFlipped ? `${item.label}: ${item.detail}` : t('pageBlocks.flipCard', { front: item.label })}
                onClick={() => setFlipped((current) => isFlipped ? current.filter((id) => id !== item.id) : [...current, item.id])}
                className={`page-flip-card ${isFlipped ? 'is-flipped' : ''}`}
              >
                <span className="page-flip-card__inner">
                  <span className="page-flip-card__face page-flip-card__front">{item.label}</span>
                  <span className="page-flip-card__face page-flip-card__back">{item.detail}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </BlockFrame>
  )
}

// ---------------------------------------------------------------------------
// Diagrams: one way of laying items out, shared by diagrams, hotspots and
// animated explainers.
// ---------------------------------------------------------------------------

function Arrangement({ layout, items, renderNode, label }) {
  if (layout === 'hub') {
    const [centre, ...spokes] = items
    return (
      <div className="page-diagram page-diagram--hub" role="list" aria-label={label}>
        <div role="listitem" className="page-diagram__centre">{centre && renderNode(centre, 0)}</div>
        <div className="page-diagram__spokes">
          {spokes.map((item, index) => <div role="listitem" key={item.id} className="page-diagram__spoke">{renderNode(item, index + 1)}</div>)}
        </div>
      </div>
    )
  }
  if (layout === 'comparison' || layout === 'grid') {
    return (
      <div className={`page-diagram page-diagram--${layout}`} role="list" aria-label={label}>
        {items.map((item, index) => <div role="listitem" key={item.id}>{renderNode(item, index)}</div>)}
      </div>
    )
  }
  // flow, cycle and build: in order, with arrows between; a cycle returns
  // to its start. Stacked with arrows pointing down, or side by side on a
  // wide screen when there are few enough steps to fit on one line.
  return (
    <ol className={`page-diagram page-diagram--${layout === 'cycle' ? 'cycle' : 'flow'} ${items.length <= 4 ? 'page-diagram--row' : ''}`} aria-label={label}>
      {items.map((item, index) => (
        <li key={item.id} className="page-diagram__step">
          {renderNode(item, index)}
          {(index < items.length - 1 || layout === 'cycle') && (
            <span className="page-diagram__arrow" aria-hidden="true">{index < items.length - 1 ? '→' : '↺'}</span>
          )}
        </li>
      ))}
    </ol>
  )
}

function DiagramNode({ item }) {
  return (
    <div className="page-diagram__node">
      <span className="page-diagram__label">{item.label}</span>
      {item.detail && <span className="page-diagram__detail">{item.detail}</span>}
    </div>
  )
}

export function Diagram({ block }) {
  return (
    <BlockFrame title={block.title} caption={block.caption}>
      <Arrangement layout={block.layout} items={block.items} label={block.title} renderNode={(item) => <DiagramNode item={item} />} />
    </BlockFrame>
  )
}

export function Hotspots({ block }) {
  const { t } = useOptionalLanguage()
  const [openId, setOpenId] = useState(null)
  const open = block.items.find((item) => item.id === openId)
  const panelId = useId()
  return (
    <BlockFrame title={block.title} caption={block.caption}>
      <p className="page-interactive__hint">{t('pageBlocks.hotspotHint')}</p>
      <Arrangement
        layout={block.layout}
        items={block.items}
        label={block.title}
        renderNode={(item, index) => (
          <button
            type="button"
            aria-expanded={openId === item.id}
            aria-controls={panelId}
            onClick={() => setOpenId((current) => current === item.id ? null : item.id)}
            className={`page-diagram__node page-hotspot ${openId === item.id ? 'is-open' : ''}`}
          >
            <span className="page-hotspot__marker" aria-hidden="true">{index + 1}</span>
            <span className="page-diagram__label">{item.label}</span>
          </button>
        )}
      />
      <div id={panelId} role="status" className={`page-hotspot__panel ${open ? 'is-open' : ''}`}>
        {open ? (
          <>
            <strong>{open.label}</strong>
            <span>{open.detail}</span>
          </>
        ) : null}
      </div>
    </BlockFrame>
  )
}

// ---------------------------------------------------------------------------
// Animated explainer: steps build up one at a time.
// ---------------------------------------------------------------------------

const STEP_MS = 3500

export function Animation({ block }) {
  const { t } = useOptionalLanguage()
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(false)
  const last = block.items.length - 1

  useEffect(() => {
    if (!playing) return undefined
    if (step >= last) {
      setPlaying(false)
      return undefined
    }
    const timer = setTimeout(() => setStep((current) => Math.min(last, current + 1)), STEP_MS)
    return () => clearTimeout(timer)
  }, [playing, step, last])

  const current = block.items[step]
  return (
    <BlockFrame title={block.title} caption={block.caption} className="page-animation">
      <Arrangement
        layout={block.layout === 'build' ? 'flow' : block.layout}
        items={block.items}
        label={block.title}
        renderNode={(item, index) => (
          <div
            className={`page-diagram__node page-animation__node ${index < step ? 'is-past' : index === step ? 'is-current' : 'is-ahead'}`}
            aria-current={index === step ? 'step' : undefined}
          >
            <span className="page-diagram__label">{item.label}</span>
          </div>
        )}
      />
      {current && (
        <div className="page-animation__now" aria-live="polite">
          <span className="page-animation__count">{t('pageBlocks.stepOf', { current: step + 1, total: block.items.length })}</span>
          <strong>{current.label}</strong>
          {current.detail && <span>{current.detail}</span>}
        </div>
      )}
      <div className="page-interactive__actions page-animation__controls">
        <button type="button" className="page-interactive__button page-interactive__button--quiet" onClick={() => { setPlaying(false); setStep((value) => Math.max(0, value - 1)) }} disabled={step === 0}>
          {t('pageBlocks.previous')}
        </button>
        {step >= last ? (
          <button type="button" className="page-interactive__button" onClick={() => { setStep(0); setPlaying(false) }}>
            {t('pageBlocks.restart')}
          </button>
        ) : (
          <button type="button" className="page-interactive__button" onClick={() => setPlaying((value) => !value)} aria-pressed={playing}>
            {playing ? t('pageBlocks.pause') : t('pageBlocks.play')}
          </button>
        )}
        <button type="button" className="page-interactive__button page-interactive__button--quiet" onClick={() => { setPlaying(false); setStep((value) => Math.min(last, value + 1)) }} disabled={step >= last}>
          {t('pageBlocks.next')}
        </button>
      </div>
    </BlockFrame>
  )
}

// ---------------------------------------------------------------------------
// Reveal sections
// ---------------------------------------------------------------------------

export function Accordion({ block }) {
  return (
    <BlockFrame title={block.title} caption={block.caption}>
      <div className="page-accordion">
        {block.items.map((item) => (
          <details key={item.id}>
            <summary>{item.label}</summary>
            <p>{item.detail}</p>
          </details>
        ))}
      </div>
    </BlockFrame>
  )
}

// ---------------------------------------------------------------------------
// Put in order
// ---------------------------------------------------------------------------

export function Ordering({ block }) {
  const { t } = useOptionalLanguage()
  const initial = useMemo(() => startingOrder(block.items, block.id), [block.items, block.id])
  const [order, setOrder] = useState(initial)
  const [checked, setChecked] = useState(false)
  const byId = new Map(block.items.map((item) => [item.id, item]))
  const correctOrder = block.items.map((item) => item.id)
  const allRight = order.every((id, index) => id === correctOrder[index])

  function move(index, delta) {
    setChecked(false)
    setOrder((current) => {
      const next = [...current]
      const target = index + delta
      if (target < 0 || target >= next.length) return current
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  return (
    <BlockFrame title={block.title}>
      <p className="page-interactive__hint">{t('pageBlocks.orderHint')}</p>
      <ol className="page-ordering">
        {order.map((id, index) => {
          const item = byId.get(id)
          const state = !checked ? '' : id === correctOrder[index] ? 'is-correct' : 'is-wrong'
          return (
            <li key={id} className={`page-ordering__item ${state}`}>
              <span className="page-ordering__number" aria-hidden="true">{index + 1}</span>
              <span className="page-ordering__label">{item?.label}</span>
              <span className="page-ordering__moves">
                <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={t('pageBlocks.moveUp', { label: item?.label })}>↑</button>
                <button type="button" onClick={() => move(index, 1)} disabled={index === order.length - 1} aria-label={t('pageBlocks.moveDown', { label: item?.label })}>↓</button>
              </span>
            </li>
          )
        })}
      </ol>
      <div className="page-interactive__actions">
        <button type="button" className="page-interactive__button" onClick={() => setChecked(true)}>{t('pageBlocks.checkOrder')}</button>
        {checked && (
          <p role="status" className={`page-interactive__result ${allRight ? 'is-correct' : 'is-wrong'}`}>
            {allRight ? t('pageBlocks.orderRight') : t('pageBlocks.orderWrong')}
          </p>
        )}
      </div>
      {checked && allRight && block.caption && <p className="page-interactive__caption">{block.caption}</p>}
    </BlockFrame>
  )
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

function formatValue(value, unit) {
  const number = Number.isInteger(value) ? value : Math.round(value * 10) / 10
  return unit ? `${number} ${unit}`.replace(/ %$/, '%') : String(number)
}

function BarChart({ items, unit }) {
  const max = Math.max(...items.map((item) => item.value), 0) || 1
  const width = 100 / items.length
  return (
    <svg viewBox="0 0 100 60" className="page-chart__svg" aria-hidden="true">
      {items.map((item, index) => {
        const height = Math.max(0, (item.value / max) * 48)
        return (
          <g key={item.id}>
            <rect x={index * width + width * 0.15} y={52 - height} width={width * 0.7} height={height} rx="0.8" fill={SERIES_COLOURS[0]} />
            <text x={index * width + width / 2} y={50 - height} textAnchor="middle" className="page-chart__value">{formatValue(item.value, unit)}</text>
          </g>
        )
      })}
      <line x1="0" y1="52" x2="100" y2="52" className="page-chart__axis" />
    </svg>
  )
}

function LineChart({ items, unit }) {
  const values = items.map((item) => item.value)
  const max = Math.max(...values, 0)
  const min = Math.min(...values, 0)
  const span = max - min || 1
  const x = (index) => (items.length === 1 ? 50 : 6 + (index / (items.length - 1)) * 88)
  const y = (value) => 50 - ((value - min) / span) * 42
  return (
    <svg viewBox="0 0 100 60" className="page-chart__svg" aria-hidden="true">
      <line x1="0" y1="52" x2="100" y2="52" className="page-chart__axis" />
      <polyline points={items.map((item, index) => `${x(index)},${y(item.value)}`).join(' ')} fill="none" stroke={SERIES_COLOURS[0]} strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
      {items.map((item, index) => (
        <g key={item.id}>
          <circle cx={x(index)} cy={y(item.value)} r="1.4" fill={SERIES_COLOURS[0]} />
          <text x={x(index)} y={y(item.value) - 3} textAnchor="middle" className="page-chart__value">{formatValue(item.value, unit)}</text>
        </g>
      ))}
    </svg>
  )
}

function PieChart({ items }) {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.value), 0) || 1
  let angle = -Math.PI / 2
  return (
    <svg viewBox="-1.1 -1.1 2.2 2.2" className="page-chart__svg page-chart__svg--pie" aria-hidden="true">
      {items.map((item, index) => {
        const share = Math.max(0, item.value) / total
        const start = angle
        angle += share * Math.PI * 2
        if (share >= 0.9999) return <circle key={item.id} r="1" fill={SERIES_COLOURS[index % SERIES_COLOURS.length]} />
        const large = share > 0.5 ? 1 : 0
        const path = `M0 0 L${Math.cos(start)} ${Math.sin(start)} A1 1 0 ${large} 1 ${Math.cos(angle)} ${Math.sin(angle)} Z`
        return <path key={item.id} d={path} fill={SERIES_COLOURS[index % SERIES_COLOURS.length]} stroke="var(--color-card)" strokeWidth="0.02" />
      })}
    </svg>
  )
}

export function Chart({ block }) {
  const { t } = useOptionalLanguage()
  const items = block.items
  const summary = items.map((item) => `${item.label}: ${formatValue(item.value, block.unit)}`).join(', ')
  return (
    <BlockFrame title={block.title} caption={block.caption} className="page-chart">
      <figure role="img" aria-label={`${block.title ? `${block.title}. ` : ''}${summary}`} className="page-chart__figure">
        {block.layout === 'pie' ? <PieChart items={items} /> : block.layout === 'line' ? <LineChart items={items} unit={block.unit} /> : <BarChart items={items} unit={block.unit} />}
        <ul className={`page-chart__legend ${block.layout === 'pie' ? '' : 'page-chart__legend--axis'}`} aria-hidden="true" style={{ '--chart-columns': items.length }}>
          {items.map((item, index) => (
            <li key={item.id}>
              {block.layout === 'pie' && <span className="page-chart__swatch" style={{ background: SERIES_COLOURS[index % SERIES_COLOURS.length] }} />}
              {item.label}{block.layout === 'pie' ? ` (${formatValue(item.value, block.unit)})` : ''}
            </li>
          ))}
        </ul>
      </figure>
      <table className="sr-only">
        <caption>{t('pageBlocks.chartData')}</caption>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}><th scope="row">{item.label}</th><td>{formatValue(item.value, block.unit)}</td></tr>
          ))}
        </tbody>
      </table>
    </BlockFrame>
  )
}
