import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// How the player moves through a catalogue course with sections: which
// sections the outline shows open, where the view starts on each page, and
// the progress it reports to an overlay.

const progress = vi.hoisted(() => ({ byItem: {} }))

vi.mock('../lib/supabaseClient', () => {
  const course = { id: 'c1', name: 'Negotiation basics', catalogue_course_id: 'cat-1', cohort_id: null, completed_date: null }
  const chain = { select: () => chain, eq: () => chain, maybeSingle: () => Promise.resolve({ data: course, error: null }) }
  return { supabase: { from: () => chain } }
})
vi.mock('../lib/courseContent', () => ({
  listCourseSections: () => Promise.resolve([
    { id: 's1', title: 'Getting started', position: 0, instructions: null },
    { id: 's2', title: 'Going further', position: 1, instructions: null },
  ]),
  listCourseResources: () => Promise.resolve([
    { id: 'p1', title: 'Welcome', type: 'page', sectionId: 's1', position: 0, page_content: { version: '1', blocks: [] } },
    { id: 'p2', title: 'Preparing', type: 'page', sectionId: 's1', position: 1, page_content: { version: '1', blocks: [] } },
    { id: 'p3', title: 'Closing', type: 'page', sectionId: 's2', position: 0, page_content: { version: '1', blocks: [] } },
  ]),
  listContentProgress: () => Promise.resolve({ ...progress.byItem }),
  markContentComplete: vi.fn(async (itemId) => { progress.byItem[itemId] = { status: 'completed' } }),
  saveContentScore: vi.fn(),
  contentFileUrl: () => '',
}))
vi.mock('../lib/courseCatalogue', () => ({
  completeMyCourse: vi.fn(() => Promise.resolve('2026-11-18')),
  getCourseCohort: vi.fn(),
  getCourseCompletionPolicy: () => Promise.resolve('all_content'),
  cohortDisplayName: () => '',
  formatCohortDateTime: () => '',
}))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }))
vi.mock('../context/LanguageContext', () => import('../test/languageMock'))
vi.mock('../components/AppHeader', () => ({ default: () => <header>Header</header> }))
vi.mock('../components/PageContent', () => ({ default: () => <p>Page body</p> }))
vi.mock('../lib/device', () => ({ useIsDesktop: () => true }))

const { default: CourseLearn } = await import('./CourseLearn')

const scrolled = []
beforeEach(() => {
  progress.byItem = {}
  scrolled.length = 0
  Element.prototype.scrollIntoView = function scrollIntoView() { scrolled.push(this) }
})
afterEach(() => {
  cleanup()
  delete Element.prototype.scrollIntoView
})

const nav = () => screen.getByRole('navigation')
const sectionToggle = (name) => within(nav()).getByRole('button', { name: new RegExp(name) })

describe('moving through a course', () => {
  it('keeps only the current page\'s section open, and starts each page at its top', async () => {
    render(<MemoryRouter><CourseLearn courseId="c1" /></MemoryRouter>)
    await screen.findByRole('heading', { name: 'Welcome' })

    expect(sectionToggle('Getting started')).toHaveAttribute('aria-expanded', 'true')
    expect(sectionToggle('Going further')).toHaveAttribute('aria-expanded', 'false')
    expect(within(nav()).queryByRole('button', { name: /Closing/ })).not.toBeInTheDocument()
    expect(scrolled).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await screen.findByRole('heading', { name: 'Preparing' })
    // Back to the top of the new page, not left where the last one ended.
    await waitFor(() => expect(scrolled).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await screen.findByRole('heading', { name: 'Closing' })
    // Into the next section: it opens, and the one left behind closes.
    await waitFor(() => expect(sectionToggle('Going further')).toHaveAttribute('aria-expanded', 'true'))
    expect(sectionToggle('Getting started')).toHaveAttribute('aria-expanded', 'false')
    await waitFor(() => expect(scrolled).toHaveLength(2))

    // Another section can still be opened to look back.
    fireEvent.click(sectionToggle('Getting started'))
    expect(within(nav()).getByRole('button', { name: /Welcome/ })).toBeInTheDocument()
  })

  it('reports its progress to an overlay instead of showing it', async () => {
    const onProgressChange = vi.fn()
    render(<MemoryRouter><CourseLearn courseId="c1" inOverlay onProgressChange={onProgressChange} /></MemoryRouter>)
    await screen.findByRole('heading', { name: 'Welcome' })
    await waitFor(() => expect(onProgressChange).toHaveBeenLastCalledWith({ done: 0, total: 3, percent: 0 }))
    expect(screen.queryByText('0 / 3 complete')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(onProgressChange).toHaveBeenLastCalledWith({ done: 1, total: 3, percent: 33 }))
  })
})
