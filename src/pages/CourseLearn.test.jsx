import { cleanup, render, screen } from '@testing-library/react'
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
    expect(isContentComplete('incomplete')).toBe(false)
    expect(isContentComplete('failed')).toBe(false)
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
    expect(screen.getByRole('button', { name: 'Complete page & continue' })).toBeInTheDocument()
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
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'learnscope.scorm.progress',
      status: 'not attempted',
      score: 0,
    }), '*')
  })
})
