import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/supabaseClient', () => {
  const course = { id: 'c1', name: 'First aid', catalogue_course_id: null, cohort_id: null }
  const chain = { select: () => chain, eq: () => chain, maybeSingle: () => Promise.resolve({ data: course, error: null }) }
  return { supabase: { from: () => chain } }
})
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }))
vi.mock('../context/LanguageContext', () => import('../test/languageMock'))
vi.mock('../components/AppHeader', () => ({ default: () => <header>Header</header> }))
vi.mock('../lib/device', () => ({ useIsDesktop: () => true }))

import CourseLearn, { CourseItemPlayer, isContentComplete } from './CourseLearn'

afterEach(cleanup)

function renderAt(state) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/courses/c1/learn', state }]}>
      <Routes><Route path="/courses/:id/learn" element={<CourseLearn />} /></Routes>
    </MemoryRouter>
  )
}

describe('CourseLearn', () => {
  it('only counts terminal successful statuses as completed content', () => {
    expect(isContentComplete('completed')).toBe(true)
    expect(isContentComplete('passed')).toBe(true)
    expect(isContentComplete('failed')).toBe(true)
    expect(isContentComplete('incomplete')).toBe(false)
    expect(isContentComplete('not_attempted')).toBe(false)
  })

  it('labels page-builder navigation with its position and page-specific actions', () => {
    render(
      <CourseItemPlayer
        item={{ id: 'page-2', type: 'page', page_content: { version: '1', blocks: [] } }}
        courseId="course-1"
        hasPrevious
        hasNext
        isComplete={false}
        progress={25}
        onMarkComplete={vi.fn()}
        onPrevious={vi.fn()}
        onProgress={vi.fn()}
        pageNumber={2}
        pageCount={4}
      />
    )

    expect(screen.getByText('Page 2 of 4')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeInTheDocument()
    // Moving on is simply the next page, whether or not it's been read yet.
    expect(screen.getByRole('button', { name: 'Next page' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Complete page/ })).not.toBeInTheDocument()
  })

  it('finishes a page course with Complete page on its last page', () => {
    const onMarkComplete = vi.fn()
    render(
      <CourseItemPlayer
        item={{ id: 'page-4', type: 'page', page_content: { version: '1', blocks: [] } }}
        courseId="course-1"
        hasPrevious
        hasNext={false}
        isComplete={false}
        progress={75}
        onMarkComplete={onMarkComplete}
        onPrevious={vi.fn()}
        onProgress={vi.fn()}
        pageNumber={4}
        pageCount={4}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Complete page' }))
    expect(onMarkComplete).toHaveBeenCalled()
  })

  it('shows a personal course with a translated back link and empty state', async () => {
    renderAt({ backTo: '/dashboard', backLabel: 'Dashboard' })
    expect(await screen.findByRole('heading', { name: 'First aid' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '← Back to Dashboard' })).toBeInTheDocument()
    expect(screen.getByText(/This is a personal record/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit course' })).toBeInTheDocument()
  })

  it('keeps a record name passed as the back label unchanged', async () => {
    renderAt({ backTo: '/skills/s1', backLabel: 'Facilitation' })
    expect(await screen.findByRole('link', { name: '← Back to Facilitation' })).toBeInTheDocument()
  })

  it('reports hosted-course progress to a parent SCORM launcher', async () => {
    const postMessage = vi.spyOn(window.parent, 'postMessage')
    render(
      <MemoryRouter>
        <CourseLearn courseId="c1" embeddedScorm />
      </MemoryRouter>
    )

    expect(await screen.findByRole('heading', { name: 'First aid' })).toBeInTheDocument()
    expect(screen.queryByText('Header')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Back to/ })).not.toBeInTheDocument()
    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
        type: 'learnscope.scorm.progress',
        status: 'not attempted',
        score: 0,
      }), '*')
    })
  })

  it('opens inside an overlay without the page\'s header, back link, title or editing', async () => {
    const postMessage = vi.spyOn(window.parent, 'postMessage')
    postMessage.mockClear()
    render(
      <MemoryRouter>
        <CourseLearn courseId="c1" inOverlay />
      </MemoryRouter>
    )
    expect(await screen.findByText(/This is a personal record/)).toBeInTheDocument()
    expect(screen.queryByText('Header')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Back to/ })).not.toBeInTheDocument()
    // The overlay names the course; the page under it already has the main landmark.
    expect(screen.queryByRole('heading', { name: 'First aid' })).not.toBeInTheDocument()
    expect(screen.queryByRole('main')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit course' })).not.toBeInTheDocument()
    // Not a SCORM export: nothing is reported to a parent window.
    expect(postMessage).not.toHaveBeenCalled()
  })

  it('closes the course with Done on its finished last item when it can, and only then', () => {
    const player = (props) => (
      <CourseItemPlayer
        item={{ id: 'page-4', type: 'page', page_content: { version: '1', blocks: [] } }}
        courseId="course-1"
        hasPrevious
        progress={100}
        onPrevious={vi.fn()}
        onProgress={vi.fn()}
        pageNumber={4}
        pageCount={4}
        {...props}
      />
    )
    const onDone = vi.fn()
    const onMarkComplete = vi.fn()
    const { rerender } = render(player({ hasNext: false, isComplete: true, onDone, onMarkComplete }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onMarkComplete).not.toHaveBeenCalled()

    // Not finished yet: completing it comes first.
    rerender(player({ hasNext: false, isComplete: false, onDone, onMarkComplete }))
    fireEvent.click(screen.getByRole('button', { name: 'Complete page' }))
    expect(onMarkComplete).toHaveBeenCalledTimes(1)
    expect(onDone).toHaveBeenCalledTimes(1)

    // On its own page there's nothing to close: Done records it as before.
    rerender(player({ hasNext: false, isComplete: true, onDone: null, onMarkComplete }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onMarkComplete).toHaveBeenCalledTimes(2)
  })
})
