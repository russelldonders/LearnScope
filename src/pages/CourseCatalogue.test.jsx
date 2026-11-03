import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/supabaseClient', () => {
  const result = Promise.resolve({ data: [], error: null })
  const chain = { select: () => chain, eq: () => chain, not: () => chain, order: () => result }
  return { supabase: { from: () => chain } }
})
vi.mock('../lib/courseCatalogue', () => ({
  listCatalogueCourses: vi.fn().mockResolvedValue([
    {
      id: 'k1', name: 'Coaching basics', provider: 'Acme Learning', synopsis: 'Start here.',
      tags: [{ id: 't1', name: 'Leadership' }], catalogues: [],
      skillEntries: [{ skillId: 'l1', skillName: 'Coaching', level: 2, isComposite: true }],
    },
  ]),
  listEnrolledCatalogueIds: vi.fn().mockResolvedValue(new Map()),
  enrolInCatalogueCourse: vi.fn(),
  formatCoursePrice: () => null,
  listCourseCohorts: vi.fn(),
  enrolInCourseCohort: vi.fn(),
}))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }))
vi.mock('../context/LanguageContext', () => import('../test/languageMock'))
vi.mock('../components/AppHeader', () => ({ default: () => <header>Header</header> }))
vi.mock('../components/CourseThumbnail', () => ({ default: () => null }))

import CourseCatalogue from './CourseCatalogue'

afterEach(cleanup)

describe('CourseCatalogue', () => {
  it('renders the catalogue, course card and filters from translation keys', async () => {
    render(<MemoryRouter><CourseCatalogue /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Coaching basics' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Find training' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Search training' })).toBeInTheDocument()
    expect(screen.getByText(/· Composite/)).toBeInTheDocument()
    expect(screen.getByText('Leadership')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enrol' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show filters' }))
    expect(screen.getByRole('button', { name: 'Hide filters' })).toBeInTheDocument()
    expect(screen.getByText('Target level')).toBeInTheDocument()
  })
})
