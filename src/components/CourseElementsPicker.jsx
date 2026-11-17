import { useId } from 'react'
import { INTERACTIVE_BLOCKS } from '../lib/pageBuilder'

// Which interactive and visual elements the AI may use in a generated course,
// and how much. Used by the single-course generator and by "Build courses
// from skills"; the server keeps the AI to exactly these (api/_lib/
// courseDraft.js).

const COURSE_ELEMENTS = Object.keys(INTERACTIVE_BLOCKS)

const ELEMENT_HINTS = {
  knowledge_check: 'Practice questions with feedback',
  test_question: 'Auto-marked questions with points',
  flip_cards: 'Terms to recall',
  hotspots: 'Explore the parts of a model',
  accordion: 'Optional depth to open',
  ordering: 'Put steps in order',
  chart: 'Bar, line and pie charts',
  diagram: 'Flows, cycles and comparisons',
  animation: 'Step-by-step animated explainers',
}

const AMOUNTS = [
  { value: 'light', label: 'Light', hint: 'About one page in three' },
  { value: 'balanced', label: 'Balanced', hint: 'Most pages, up to two each' },
  { value: 'rich', label: 'Rich', hint: 'Every page, up to three each' },
]

export default function CourseElementsPicker({ elements, amount, onChange, excludedElements = [] }) {
  const id = useId()
  const availableElements = COURSE_ELEMENTS.filter((element) => !excludedElements.includes(element))
  const allChosen = availableElements.every((element) => elements.includes(element))

  function toggle(element) {
    onChange({
      elements: elements.includes(element)
        ? elements.filter((value) => value !== element)
        : availableElements.filter((value) => value === element || elements.includes(value)),
    })
  }

  return (
    <fieldset className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <legend className="font-medium text-ink">Interactive and visual elements</legend>
        <button type="button" onClick={() => onChange({ elements: allChosen ? [] : availableElements })} className="text-xs font-medium text-moss hover:underline">
          {allChosen ? 'Clear all' : 'Select all'}
        </button>
      </div>
      <p className="text-sm text-secondary">
        The AI uses only these, where they help the learning.
        {elements.includes('knowledge_check') ? ' Every section gets at least one knowledge check.' : ''}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {availableElements.map((element) => (
          <label key={element} className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 ${elements.includes(element) ? 'border-moss bg-moss/10' : 'border-hairline bg-paper'}`}>
            <input type="checkbox" checked={elements.includes(element)} onChange={() => toggle(element)} className="mt-0.5 h-4 w-4 accent-moss" />
            <span>
              <span className="block text-sm font-medium text-ink">{INTERACTIVE_BLOCKS[element].label}</span>
              <span className="block text-xs text-secondary">{ELEMENT_HINTS[element]}</span>
            </span>
          </label>
        ))}
      </div>
      {elements.length === 0 ? (
        <p className="text-xs text-secondary">None chosen: courses will use text, callouts and quotes only.</p>
      ) : (
        <div role="radiogroup" aria-labelledby={`${id}-amount`}>
          <p id={`${id}-amount`} className="mb-1.5 text-xs font-medium text-secondary">How much to use them</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {AMOUNTS.map((option) => (
              <label key={option.value} className={`cursor-pointer rounded-lg border px-3 py-2 ${amount === option.value ? 'border-moss bg-moss/10' : 'border-hairline bg-paper'}`}>
                <span className="flex items-center gap-2">
                  <input type="radio" name={`${id}-amount`} value={option.value} checked={amount === option.value} onChange={() => onChange({ amount: option.value })} className="h-4 w-4 accent-moss" />
                  <span className="text-sm font-medium text-ink">{option.label}</span>
                </span>
                <span className="mt-0.5 block text-xs text-secondary">{option.hint}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </fieldset>
  )
}
