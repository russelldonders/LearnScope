import { useId } from 'react'
import { BLOCK_LAYOUTS, INTERACTIVE_BLOCKS } from '../lib/pageBuilder'

// Editing an interactive or visual page block (see INTERACTIVE_BLOCKS in
// lib/pageBuilder.js): its title, how it's laid out, and its items. The
// page editor's Preview shows it as learners will.

const LAYOUT_LABELS = {
  single: 'One right answer', multiple: 'Several right answers',
  true_false: 'True or false', short_text: 'Short answer', number: 'Number', ordering: 'Ordering', matching: 'Matching',
  bar: 'Bar', line: 'Line', pie: 'Pie',
  flow: 'Flow', cycle: 'Cycle', hub: 'Hub and spokes', comparison: 'Side by side', grid: 'Grid', build: 'Build up',
}

const FIELDS = {
  knowledge_check: { title: 'Question', label: 'Answer', detail: 'Feedback for this answer', correct: true, hint: 'Tick every right answer. Learners see the feedback for what they chose.' },
  test_question: { title: 'Question', label: 'Answer', detail: 'Match', correct: true, caption: 'Feedback shown after marking (optional)', hint: 'This question contributes to the page test score.' },
  flip_cards: { title: 'Heading (optional)', label: 'Front', detail: 'Back', hint: 'A term or prompt on the front, the explanation on the back.' },
  hotspots: { title: 'Heading', label: 'Point', detail: 'What it reveals', hint: 'Each point is numbered on the diagram; selecting it reveals its text.' },
  accordion: { title: 'Heading (optional)', label: 'Section heading', detail: 'Section content', hint: 'Learners open each section to read it.' },
  ordering: { title: 'What to put in order', label: 'Step', caption: 'Shown when it’s right (optional)', hint: 'List the steps in the right order; learners see them mixed up.' },
  chart: { title: 'Chart title', label: 'Label', value: true, unit: true, caption: 'Caption', hint: 'Say in the caption if the figures are illustrative rather than real data.' },
  diagram: { title: 'Heading', label: 'Box', detail: 'Description (optional)', caption: 'Caption (optional)' },
  animation: { title: 'Heading', label: 'Step', detail: 'What happens', hint: 'Learners play it, or step through it, one step at a time.' },
}

const inputClass = 'w-full rounded-md border border-hairline bg-paper px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:border-moss'

function newItem() {
  return { id: crypto.randomUUID(), label: '', detail: '', value: 0, correct: false }
}

export default function PageInteractiveEditor({ block, onChange, onChangeWithHistory }) {
  const spec = INTERACTIVE_BLOCKS[block.type]
  const fields = FIELDS[block.type]
  const layouts = BLOCK_LAYOUTS[block.type]
  const idPrefix = useId()
  const items = block.items ?? []
  const scored = block.type === 'test_question'
  const choice = scored && ['single', 'multiple', 'true_false'].includes(block.layout)
  const ordering = scored && block.layout === 'ordering'
  const matching = scored && block.layout === 'matching'
  const shortText = scored && block.layout === 'short_text'
  const number = scored && block.layout === 'number'

  function updateItem(id, changes) {
    onChange({ items: items.map((item) => item.id === id ? { ...item, ...changes } : item) })
  }
  function moveItem(index, delta) {
    const next = [...items]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    onChangeWithHistory({ items: next })
  }

  function changeLayout(layout) {
    if (!scored) return onChangeWithHistory({ layout })
    let nextItems = items
    if (layout === 'true_false') nextItems = [
      { id: crypto.randomUUID(), label: 'True', detail: '', value: 0, correct: true },
      { id: crypto.randomUUID(), label: 'False', detail: '', value: 0, correct: false },
    ]
    else if (layout === 'number') nextItems = [{ id: crypto.randomUUID(), label: 'Correct number', detail: '', value: 0, correct: true }]
    else if (layout === 'short_text') nextItems = [{ id: crypto.randomUUID(), label: '', detail: '', value: 0, correct: true }]
    else if (nextItems.length < 2 && ['single', 'multiple', 'ordering', 'matching'].includes(layout)) nextItems = [newItem(), newItem()]
    onChangeWithHistory({ layout, items: nextItems })
  }

  return (
    <div className="page-interactive-editor rounded-xl border border-dashed border-moss/50 bg-moss/5 p-4 text-sm" onClick={(event) => event.stopPropagation()}>
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-moss">{spec.label}</p>
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs text-secondary">{fields.title}</span>
          <input value={block.title ?? ''} onChange={(event) => onChange({ title: event.target.value })} className={inputClass} />
        </label>
        {layouts && (
          <div role="group" aria-label="Layout">
            <span className="mb-1 block text-xs text-secondary">Layout</span>
            <div className="page-block-options">
              {layouts.map((layout) => (
                <button key={layout} type="button" aria-pressed={block.layout === layout} className={block.layout === layout ? 'is-selected' : ''} onClick={() => changeLayout(layout)}>
                  {LAYOUT_LABELS[layout]}
                </button>
              ))}
            </div>
          </div>
        )}
        {scored && (
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs text-secondary">Points</span>
              <input type="number" min="1" max="100" value={block.points ?? 1} onChange={(event) => onChange({ points: Number(event.target.value) })} className={inputClass} />
            </label>
            {number && <label className="block"><span className="mb-1 block text-xs text-secondary">Accepted tolerance</span><input type="number" min="0" value={block.tolerance ?? 0} onChange={(event) => onChange({ tolerance: Number(event.target.value) })} className={inputClass} /></label>}
          </div>
        )}
        {fields.unit && (
          <label className="block">
            <span className="mb-1 block text-xs text-secondary">Unit (optional, e.g. % or hours)</span>
            <input value={block.unit ?? ''} onChange={(event) => onChange({ unit: event.target.value })} maxLength={30} className={inputClass} />
          </label>
        )}
        {fields.hint && <p className="text-xs text-secondary">{fields.hint}</p>}

        <ol className="space-y-2">
          {items.map((item, index) => (
            <li key={item.id} className="rounded-lg border border-hairline bg-card p-2.5">
              <div className="flex items-start gap-2">
                <span className="mt-1.5 w-5 shrink-0 text-xs font-semibold text-secondary">{index + 1}</span>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <input
                    aria-label={`${fields.label} ${index + 1}`}
                    placeholder={number ? 'Correct number' : matching ? 'Prompt' : shortText ? 'Accepted answer' : fields.label}
                    value={number ? item.value : item.label}
                    type={number ? 'number' : 'text'}
                    onChange={(event) => number ? updateItem(item.id, { value: Number(event.target.value) }) : updateItem(item.id, { label: event.target.value })}
                    className={inputClass}
                  />
                  {fields.detail && (!scored || matching) && (
                    <textarea
                      aria-label={`${fields.detail} ${index + 1}`}
                      placeholder={matching ? 'Correct match' : fields.detail}
                      value={item.detail}
                      rows={2}
                      onChange={(event) => updateItem(item.id, { detail: event.target.value })}
                      className={inputClass}
                    />
                  )}
                  {fields.value && (
                    <input
                      type="number"
                      aria-label={`Value ${index + 1}`}
                      placeholder="Value"
                      value={Number.isFinite(item.value) ? item.value : 0}
                      onChange={(event) => updateItem(item.id, { value: event.target.value === '' ? 0 : Number(event.target.value) })}
                      className={`${inputClass} max-w-[10rem]`}
                    />
                  )}
                  {fields.correct && (!scored || choice) && (
                    <label className="flex items-center gap-2 text-xs text-ink">
                      <input type="checkbox" checked={item.correct} onChange={(event) => onChangeWithHistory({ items: items.map((other) => other.id === item.id ? { ...other, correct: event.target.checked } : (block.layout === 'single' && event.target.checked ? { ...other, correct: false } : other)) })} className="accent-moss" />
                      {block.layout === 'true_false' ? 'Correct choice' : 'Right answer'}
                    </label>
                  )}
                </div>
                <div className="flex shrink-0 flex-col gap-1 text-xs">
                  <button type="button" onClick={() => moveItem(index, -1)} disabled={index === 0} aria-label={`Move ${fields.label.toLowerCase()} ${index + 1} up`} className="rounded border border-hairline px-1.5 disabled:opacity-35">↑</button>
                  <button type="button" onClick={() => moveItem(index, 1)} disabled={index === items.length - 1} aria-label={`Move ${fields.label.toLowerCase()} ${index + 1} down`} className="rounded border border-hairline px-1.5 disabled:opacity-35">↓</button>
                  <button type="button" onClick={() => onChangeWithHistory({ items: items.filter((other) => other.id !== item.id) })} aria-label={`Remove ${fields.label.toLowerCase()} ${index + 1}`} className="rounded border border-hairline px-1.5 text-red-700">×</button>
                </div>
              </div>
            </li>
          ))}
        </ol>
        {items.length < spec.maxItems && block.layout !== 'true_false' && !number && (
          <button type="button" onClick={() => onChangeWithHistory({ items: [...items, newItem()] })} className="text-xs font-medium text-moss hover:underline">
            + Add {shortText ? 'accepted answer' : matching ? 'pair' : ordering ? 'item' : fields.label.toLowerCase()}
          </button>
        )}
        {items.length < spec.minItems && (
          <p className="text-xs text-red-700">Add at least {spec.minItems} for learners to use this.</p>
        )}
        {fields.caption && (
          <label className="block" htmlFor={`${idPrefix}-caption`}>
            <span className="mb-1 block text-xs text-secondary">{fields.caption}</span>
            <input id={`${idPrefix}-caption`} value={block.caption ?? ''} onChange={(event) => onChange({ caption: event.target.value })} maxLength={500} className={inputClass} />
          </label>
        )}
      </div>
    </div>
  )
}
