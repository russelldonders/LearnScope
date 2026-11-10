import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('../lib/skillEvidence', async (importOriginal) => ({
  ...(await importOriginal()),
  getEvidenceSignedUrl: vi.fn().mockResolvedValue('https://example.test/photo.jpg'),
}))
vi.mock('../context/LanguageContext', async () => {
  const { english } = await import('../lib/i18n/translations')
  const t = (key, params) => {
    const value = key.split('.').reduce((v, part) => v?.[part], english) ?? key
    return params ? value.replace(/\{(\w+)\}/g, (m, name) => (name in params ? params[name] : m)) : value
  }
  return { useLanguage: () => ({ language: 'en-GB', setLanguage: vi.fn(), t }) }
})

const { default: ActivityTimeline } = await import('./ActivityTimeline')
const { DIAGNOSTIC_EXTENSION_IRI, MEASUREMENT_EXTENSION_IRI, PROVENANCE_EXTENSION_IRI, SKILL_EXTENSION_IRI } = await import('../lib/xapiStatement')

afterEach(cleanup)

const NOW = new Date(2026, 10, 8, 12).getTime()
const at = (day, hour = 9) => new Date(2026, 10, day, hour).toISOString()
const running = { id: 'skill-run', name: 'Running' }

function activity(id, day, { verb = 'https://learnscope.app/xapi/verbs/practiced', minutes, skills = [running], extensions, context = {}, description, evidence_paths, created } = {}) {
  return {
    id,
    recorded_at: at(day),
    created_at: at(created ?? day, 10),
    resource_id: null,
    evidence_paths,
    statement: {
      verb: { id: verb, display: { 'en-US': 'Practiced it' } },
      object: { definition: { name: { 'en-US': id }, ...(description ? { description: { 'en-US': description } } : {}) } },
      result: { ...(minutes ? { duration: `PT${minutes}M` } : {}), ...(extensions ? { extensions } : {}) },
      context: { extensions: { [SKILL_EXTENSION_IRI]: skills, ...context } },
    },
  }
}

function renderTimeline(rows, props = {}) {
  return render(<MemoryRouter><ActivityTimeline rows={rows} now={NOW} {...props} /></MemoryRouter>)
}

describe('ActivityTimeline', () => {
  it('groups by day with totals, and leads each activity with its figures', () => {
    renderTimeline([
      activity('Evening run', 8, {
        minutes: 25,
        extensions: { [MEASUREMENT_EXTENSION_IRI]: [{ metric: 'distance', kind: 'number', unit: 'km', value: 5 }] },
      }),
      activity('Stretching', 8, { minutes: 10 }),
      activity('Hill sprints', 7),
    ])
    expect(screen.getByRole('heading', { name: 'Today · 2 activities · 35m' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Yesterday · 1 activity' })).toBeInTheDocument()
    expect(screen.getByText('5 km')).toBeInTheDocument()
    expect(screen.getByText('25m')).toBeInTheDocument()
    expect(screen.getAllByText('Practised')).toHaveLength(3)
    expect(screen.getAllByRole('link', { name: 'Running' })[0]).toHaveAttribute('href', '/skills/skill-run')
  })

  it('totals the whole day even when only some of it is shown', () => {
    const all = [activity('Run 1', 8, { minutes: 20 }), activity('Run 2', 8, { minutes: 15 }), activity('Run 3', 8, { minutes: 10 })]
    renderTimeline(all.slice(0, 2), { allRows: all })
    expect(screen.getByRole('heading', { name: 'Today · 3 activities · 45m' })).toBeInTheDocument()
    expect(screen.queryByText('Run 3')).not.toBeInTheDocument()
  })

  it('shows the source by its logo and the synced distance as a figure', () => {
    renderTimeline([activity('Morning ride', 8, {
      description: 'Synced from Strava · 12.4 km',
      context: { [PROVENANCE_EXTENSION_IRI]: { source: 'strava', externalId: '9' } },
    })])
    const logo = screen.getByRole('img', { name: 'via Strava' })
    expect(logo.querySelector('svg')).not.toBeNull()
    expect(screen.queryByText('via Strava')).not.toBeInTheDocument()
    expect(screen.getByText('12.4 km')).toBeInTheDocument()
    expect(screen.queryByText(/Synced from/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Log again' })).not.toBeInTheDocument()
  })

  it('folds check-ins and keeps them out of the day total', () => {
    const checkIn = (id) => activity(id, 8, {
      verb: 'https://learnscope.app/xapi/verbs/assessed',
      extensions: { [DIAGNOSTIC_EXTENSION_IRI]: { confirmedLevel: 3 } },
    })
    renderTimeline([activity('Walk', 8), checkIn('Confirming baseline: Running'), checkIn('Confirming baseline: Cycling')])
    expect(screen.getByRole('heading', { name: 'Today · 1 activity' })).toBeInTheDocument()
    const fold = screen.getByRole('button', { name: /2 check-ins/ })
    const checkInText = (_, el) => el?.tagName === 'P' && el.textContent === 'Check-in · Confirming baseline: Running'
    expect(screen.queryByText(checkInText)).not.toBeInTheDocument()
    fireEvent.click(fold)
    expect(screen.getByText(checkInText)).toBeInTheDocument()
  })

  it('marks a backdated entry that was just added', () => {
    renderTimeline([activity('Old match', 1, { created: 8 })])
    expect(screen.getByText('Just added')).toBeInTheDocument()
  })

  it('offers Log again and an inline reflection', () => {
    const onLogAgain = vi.fn()
    const onOpen = vi.fn()
    const row = activity('Evening run', 8)
    renderTimeline([row], { onLogAgain, onOpen })
    fireEvent.click(screen.getByRole('button', { name: 'Log again' }))
    expect(onLogAgain).toHaveBeenCalledWith(row)
    fireEvent.click(screen.getByRole('button', { name: 'Evening run' }))
    expect(onOpen).toHaveBeenCalledWith(row)
    fireEvent.click(screen.getByRole('button', { name: 'Add a reflection' }))
    const form = screen.getByRole('button', { name: 'Add to note' }).closest('form')
    expect(within(form).getByRole('textbox')).toHaveAttribute('id', 'timeline-reflection-Evening run')
    fireEvent.click(screen.getByRole('button', { name: 'Close reflection' }))
    expect(screen.queryByRole('button', { name: 'Add to note' })).not.toBeInTheDocument()
  })

  it('shows photo evidence as thumbnails and other files as links', async () => {
    const { container } = renderTimeline([activity('Pottery', 8, { evidence_paths: ['u/s/1/bowl.jpg', 'u/s/1/notes.pdf'] })])
    expect(await screen.findByRole('button', { name: 'Attachment 1' })).toBeInTheDocument()
    await vi.waitFor(() => expect(container.querySelector('img')).toHaveAttribute('src', 'https://example.test/photo.jpg'))
    expect(screen.getByRole('button', { name: 'Attachment 2' })).toBeInTheDocument()
  })
})

describe('sets of the same thing', () => {
  const fitness = { id: 'skill-fit', name: 'Fitness' }
  const set = (id, hour, value) => {
    const row = activity('Push ups', 8, {
      verb: 'http://adlnet.gov/expapi/verbs/experienced',
      skills: [fitness],
      extensions: { [MEASUREMENT_EXTENSION_IRI]: [{ metric: 'push_ups', kind: 'count', unit: 'push-ups', value }] },
    })
    return { ...row, id, recorded_at: new Date(2026, 10, 8, hour).toISOString() }
  }

  it('shows one line with the total and how it was made up, opening to each set', () => {
    renderTimeline([set('c', 11, 20), set('b', 10, 25), set('a', 9, 15)], { onLogAgain: vi.fn() })
    expect(screen.getByRole('heading', { name: 'Today · 3 activities' })).toBeInTheDocument()
    expect(screen.getAllByText('Push ups')).toHaveLength(1)
    expect(screen.getByText('60 push-ups')).toBeInTheDocument()
    expect(screen.getByText('15 + 25 + 20')).toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: /3 sets/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(screen.getAllByText('Push ups')).toHaveLength(4)
    expect(screen.getByText('25 push-ups')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Log again' })).toHaveLength(3)
  })
})

describe('editing from the timeline', () => {
  it('offers Edit on activities the learner logged, not on imports', () => {
    const onEdit = vi.fn()
    const imported = activity('Strava run', 8, { context: { [PROVENANCE_EXTENSION_IRI]: { source: 'strava' } } })
    renderTimeline([activity('Stretching', 8), imported], { onEdit })
    const buttons = screen.getAllByRole('button', { name: 'Edit' })
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0])
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'Stretching' }))
  })
})
