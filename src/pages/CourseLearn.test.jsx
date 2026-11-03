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

import CourseLearn from './CourseLearn'

afterEach(cleanup)

function renderAt(state) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/courses/c1/learn', state }]}>
      <Routes><Route path="/courses/:id/learn" element={<CourseLearn />} /></Routes>
    </MemoryRouter>
  )
}

describe('CourseLearn', () => {
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
})
