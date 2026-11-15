import { useMemo, useState } from 'react'
import AccessibleDialog from './AccessibleDialog'
import { COURSE_TYPES } from '../lib/courseTypes'
import { DURATION_UNITS } from '../lib/courseDuration'
import { createGeneratedCourseDraft, generateCourseDraft } from '../lib/courseGeneration'

const DEFAULT_BRIEF = {
  topic: '',
  audience: '',
  outcomes: '',
  courseType: 'Online',
  durationValue: '6',
  durationUnit: 'hours',
  sectionCount: '3',
  pagesPerSection: '2',
  tone: 'Practical and encouraging',
  sourceMaterial: '',
}

const fieldClass = 'w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-gold'

export default function CourseGeneratorDialog({ organisationId, onClose, onCreated }) {
  const [brief, setBrief] = useState(DEFAULT_BRIEF)
  const [draft, setDraft] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState(null)

  const pageCount = useMemo(
    () => draft?.sections.reduce((total, section) => total + section.pages.length, 0) ?? 0,
    [draft],
  )
  const busy = generating || creating

  function change(field, value) {
    setBrief((current) => ({ ...current, [field]: value }))
  }

  async function handleGenerate(event) {
    event?.preventDefault()
    setGenerating(true)
    setError(null)
    try {
      setDraft(await generateCourseDraft(brief, organisationId))
    } catch (err) {
      setError(err.message)
    } finally {
      setGenerating(false)
    }
  }

  async function handleCreate() {
    setCreating(true)
    setError(null)
    try {
      const courseId = await createGeneratedCourseDraft(organisationId, draft)
      onCreated(courseId)
    } catch (err) {
      setError(err.message)
      setCreating(false)
    }
  }

  return (
    <AccessibleDialog
      labelledBy="course-generator-title"
      describedBy="course-generator-description"
      onClose={busy ? undefined : onClose}
      closeOnBackdrop={!busy}
      panelClassName="w-full max-w-3xl max-h-[90dvh] overflow-y-auto overscroll-contain rounded-xl border border-hairline bg-card shadow-xl"
    >
      <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-hairline bg-card px-5 py-4 sm:px-6">
        <div>
          <h2 id="course-generator-title" className="font-display text-xl text-ink">
            {draft ? 'Review generated course' : 'Build a course with AI'}
          </h2>
          <p id="course-generator-description" className="mt-1 max-w-2xl text-sm text-secondary">
            {draft
              ? 'Check the structure before creating it. Every page will open in the existing page builder.'
              : 'Describe the learning you need. LearnScope will prepare a complete, editable draft for you to review.'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="shrink-0 rounded-md border border-hairline px-3 py-1.5 text-sm text-ink hover:bg-paper active:translate-y-px disabled:opacity-50"
        >
          Close
        </button>
      </div>

      {draft ? (
        <div className="space-y-6 p-5 sm:p-6">
          {error && <p role="alert" className="rounded-md border border-red-700 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

          <section aria-labelledby="generated-course-summary">
            <h3 id="generated-course-summary" className="font-display text-2xl text-ink">{draft.name}</h3>
            <p className="mt-2 max-w-[70ch] text-sm leading-relaxed text-secondary">{draft.synopsis}</p>
            <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <div><dt className="inline text-secondary">Format: </dt><dd className="inline font-medium text-ink">{draft.courseType}</dd></div>
              <div><dt className="inline text-secondary">Duration: </dt><dd className="inline font-medium text-ink">{draft.durationValue} {draft.durationUnit}</dd></div>
              <div><dt className="inline text-secondary">Structure: </dt><dd className="inline font-medium text-ink">{draft.sections.length} sections, {pageCount} pages</dd></div>
            </dl>
          </section>

          <ol className="space-y-5" aria-label="Generated course outline">
            {draft.sections.map((section, sectionIndex) => (
              <li key={`${section.title}-${sectionIndex}`} className="border-t border-hairline pt-4">
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-xs tabular-nums text-secondary">{sectionIndex + 1}</span>
                  <div>
                    <h4 className="font-medium text-ink">{section.title}</h4>
                    {section.instructions && <p className="mt-1 text-sm text-secondary">{section.instructions}</p>}
                  </div>
                </div>
                <ul className="ml-7 mt-3 grid gap-2 sm:grid-cols-2">
                  {section.pages.map((page, pageIndex) => (
                    <li key={`${page.title}-${pageIndex}`} className="rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink">
                      {page.title}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>

          <p className="text-sm text-secondary">
            Creating this course only saves a draft. Nothing is published or added to a catalogue automatically.
          </p>

          <div className="flex flex-col-reverse gap-2 border-t border-hairline pt-4 sm:flex-row sm:justify-between">
            <button
              type="button"
              onClick={() => { setDraft(null); setError(null) }}
              disabled={busy}
              className="rounded-md border border-hairline px-4 py-2 text-sm font-medium text-ink hover:bg-paper active:translate-y-px disabled:opacity-50"
            >
              Edit brief
            </button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={busy}
                className="rounded-md border border-hairline px-4 py-2 text-sm font-medium text-ink hover:bg-paper active:translate-y-px disabled:opacity-50"
              >
                {generating ? 'Generating…' : 'Generate again'}
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={busy}
                className="rounded-md bg-moss px-4 py-2 text-sm font-medium text-paper hover:opacity-90 active:translate-y-px disabled:opacity-50"
              >
                {creating ? 'Creating draft…' : 'Create editable draft'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <form onSubmit={handleGenerate} className="space-y-5 p-5 sm:p-6">
          {error && <p role="alert" className="rounded-md border border-red-700 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

          <div>
            <label htmlFor="course-generator-topic" className="mb-1 block text-sm font-medium text-ink">Course topic</label>
            <textarea
              id="course-generator-topic"
              required
              rows={2}
              value={brief.topic}
              onChange={(event) => change('topic', event.target.value)}
              placeholder="For example, safe manual handling for warehouse teams"
              className={fieldClass}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="course-generator-audience" className="mb-1 block text-sm font-medium text-ink">Who is it for?</label>
              <textarea
                id="course-generator-audience"
                required
                rows={3}
                value={brief.audience}
                onChange={(event) => change('audience', event.target.value)}
                placeholder="Role, experience and what they already know"
                className={fieldClass}
              />
            </div>
            <div>
              <label htmlFor="course-generator-outcomes" className="mb-1 block text-sm font-medium text-ink">Learning outcomes</label>
              <textarea
                id="course-generator-outcomes"
                required
                rows={3}
                value={brief.outcomes}
                onChange={(event) => change('outcomes', event.target.value)}
                placeholder="One outcome per line"
                className={fieldClass}
              />
            </div>
          </div>

          <fieldset>
            <legend className="text-sm font-medium text-ink">Course shape</legend>
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-5">
              <label className="col-span-2 text-xs text-secondary sm:col-span-1">Format
                <select value={brief.courseType} onChange={(event) => change('courseType', event.target.value)} className={`${fieldClass} mt-1 text-sm`}>
                  {COURSE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </label>
              <label className="text-xs text-secondary">Duration
                <input type="number" min="1" max="10000" required value={brief.durationValue} onChange={(event) => change('durationValue', event.target.value)} className={`${fieldClass} mt-1 text-sm`} />
              </label>
              <label className="text-xs text-secondary">Unit
                <select value={brief.durationUnit} onChange={(event) => change('durationUnit', event.target.value)} className={`${fieldClass} mt-1 text-sm`}>
                  {DURATION_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
                </select>
              </label>
              <label className="text-xs text-secondary">Sections
                <input type="number" min="1" max="8" required value={brief.sectionCount} onChange={(event) => change('sectionCount', event.target.value)} className={`${fieldClass} mt-1 text-sm`} />
              </label>
              <label className="text-xs text-secondary">Pages each
                <input type="number" min="1" max="6" required value={brief.pagesPerSection} onChange={(event) => change('pagesPerSection', event.target.value)} className={`${fieldClass} mt-1 text-sm`} />
              </label>
            </div>
          </fieldset>

          <div>
            <label htmlFor="course-generator-tone" className="mb-1 block text-sm font-medium text-ink">Writing style</label>
            <select id="course-generator-tone" value={brief.tone} onChange={(event) => change('tone', event.target.value)} className={fieldClass}>
              <option>Practical and encouraging</option>
              <option>Concise and professional</option>
              <option>Detailed and academic</option>
              <option>Conversational and approachable</option>
            </select>
          </div>

          <div>
            <label htmlFor="course-generator-source" className="mb-1 block text-sm font-medium text-ink">Source material <span className="font-normal text-secondary">(optional)</span></label>
            <textarea
              id="course-generator-source"
              rows={5}
              value={brief.sourceMaterial}
              onChange={(event) => change('sourceMaterial', event.target.value)}
              placeholder="Paste policies, notes, reference text or facts the course should use"
              className={fieldClass}
            />
            <p className="mt-1 text-xs text-secondary">Only include material you are comfortable sending to the AI service.</p>
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-hairline pt-4 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} disabled={busy} className="rounded-md border border-hairline px-4 py-2 text-sm font-medium text-ink hover:bg-paper active:translate-y-px disabled:opacity-50">Cancel</button>
            <button type="submit" disabled={busy} className="rounded-md bg-moss px-4 py-2 text-sm font-medium text-paper hover:opacity-90 active:translate-y-px disabled:opacity-50">
              {generating ? 'Building course…' : 'Generate course'}
            </button>
          </div>
        </form>
      )}
    </AccessibleDialog>
  )
}
