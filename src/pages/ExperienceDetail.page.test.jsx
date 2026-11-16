import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ExperienceDetail from './ExperienceDetail'
import { LanguageProvider } from '../context/LanguageContext'

// Page-level characterisation tests: what an experience's page shows from a
// given set of records, and what it saves, so its loading code and
// components can be reorganised without changing what the learner sees.

const db = vi.hoisted(() => ({ tables: {}, calls: [] }))

vi.mock('../lib/supabaseClient', async () => {
  const { createSupabaseFake } = await import('../test/supabaseFake')
  return { supabase: createSupabaseFake(db) }
})
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'learner-1', email: 'learner@example.com' } }) }))
vi.mock('../components/AppHeader', () => ({ default: () => null }))
vi.mock('../components/OrganizationLogo', () => ({ default: () => null }))
vi.mock('./roles/useMyRoleAssignments', () => ({
  useMyRoleAssignments: () => ({
    linkedAssignments: [],
    alignmentByAssignmentId: {},
    loading: false,
    disconnectAssignment: vi.fn(),
  }),
}))
vi.mock('../lib/experienceSkillRecommendations', () => ({
  recommendExperienceSkills: vi.fn(),
  addRecommendedSkills: vi.fn(),
}))

const job = {
  id: 'exp-1',
  user_id: 'learner-1',
  type: 'employment',
  title: 'Product Manager',
  organization: 'Acme',
  organization_url: null,
  start_date: '2020-01-01',
  end_date: '2022-06-30',
  description: 'Led a cross-functional product team.',
  parent_experience_id: null,
  study_duration: null,
  study_duration_value: null,
  study_duration_unit: null,
  other_type: null,
}
const project = {
  ...job,
  id: 'exp-2',
  type: 'project',
  title: 'Checkout redesign',
  start_date: '2021-03-01',
  end_date: '2021-09-30',
  description: null,
  parent_experience_id: 'exp-1',
}

beforeEach(() => {
  db.calls = []
  db.tables = {
    experience: [job, project],
    course_experience_links: [
      { id: 'cl-1', experience_id: 'exp-1', course_id: 'course-1', courses: { id: 'course-1', name: 'Agile Foundations', provider: 'Acme Academy', completed_date: '2021-02-15' } },
    ],
    skill_experience_links: [
      { id: 'sl-1', experience_id: 'exp-1', skill_id: 'skill-1', created_at: '2020-02-01T00:00:00Z', skills: { id: 'skill-1', name: 'Roadmapping', level: 3, source: null } },
      // The same skill linked again through the child project: one row, not two.
      { id: 'sl-2', experience_id: 'exp-2', skill_id: 'skill-1', created_at: '2021-03-01T00:00:00Z', skills: { id: 'skill-1', name: 'Roadmapping', level: 3, source: null } },
    ],
    skill_assessments: [
      { id: 'as-1', experience_id: 'exp-1', skill_id: 'skill-1', level: 3, axis: 'practical', source: 'self', comments: null, assessed_at: '2021-11-01T10:00:00Z', skills: { name: 'Roadmapping' }, courses: null },
    ],
    xapi_statements: [],
    skills: [{ id: 'skill-1', user_id: 'learner-1', name: 'Roadmapping' }],
  }
})

afterEach(cleanup)

function renderPage(path = '/experience/exp-1') {
  return render(
    <LanguageProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/experience/:id" element={<ExperienceDetail />} />
          <Route path="/experience" element={<p>Experience list</p>} />
        </Routes>
      </MemoryRouter>
    </LanguageProvider>
  )
}

describe('ExperienceDetail page', () => {
  it('says so when the experience is not one of the learner’s own', async () => {
    db.tables.experience = [{ ...job, user_id: 'someone-else' }]
    renderPage()
    expect(await screen.findByText('Experience not found.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
  })

  it('shows a finished job with its timeline, sub-experiences, courses and skills', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Product Manager', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('Acme')).toBeInTheDocument()

    // Its own dated events, the project nested under it, the course
    // completed during it and the level reached while there.
    expect(await screen.findByText('Checkout redesign')).toBeInTheDocument()
    expect(screen.getByText('Led a cross-functional product team.')).toBeInTheDocument()
    expect(screen.getByText('Agile Foundations')).toBeInTheDocument()
    expect(screen.getAllByText(/Roadmapping/).length).toBeGreaterThan(0)

    // A finished experience has nothing left to add skills to.
    const tabs = screen.getAllByRole('button', { name: /^(Overview|Courses|Skills)$/ }).map((tab) => tab.textContent)
    expect(tabs).toEqual(['Overview', 'Courses'])
  })

  it('offers skills, and no courses tab, for a current job with no courses linked', async () => {
    db.tables.experience = [{ ...job, end_date: null }]
    db.tables.course_experience_links = []
    renderPage()
    await screen.findByRole('heading', { name: 'Product Manager', level: 1 })
    await waitFor(() => {
      const tabs = screen.getAllByRole('button', { name: /^(Overview|Courses|Skills)$/ }).map((tab) => tab.textContent)
      expect(tabs).toEqual(['Overview', 'Skills'])
    })
  })

  it('links a nested experience back to the one it is part of', async () => {
    renderPage('/experience/exp-2')
    expect(await screen.findByRole('heading', { name: 'Checkout redesign', level: 1 })).toBeInTheDocument()
    const parentLink = await screen.findByRole('link', { name: 'Product Manager' })
    expect(parentLink).toHaveAttribute('href', '/experience/exp-1')
  })

  it('flags an experience that ends before it starts and opens the form to correct it', async () => {
    db.tables.experience = [{ ...job, start_date: '2022-06-30', end_date: '2020-01-01' }]
    renderPage()
    expect(await screen.findByText(/ends \(.*\) before it starts \(.*\)/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Correct the dates' }))
    expect(screen.getByRole('heading', { name: 'Experience settings' })).toBeInTheDocument()
  })

  it('saves edited details against the same record, keeping its dates', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Product Manager', level: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Experience settings' }))
    fireEvent.change(screen.getByLabelText('Role title'), { target: { value: 'Senior Product Manager' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))

    await waitFor(() => expect(db.calls.some((call) => call.action === 'update')).toBe(true))
    const update = db.calls.find((call) => call.action === 'update')
    expect(update.table).toBe('experience')
    expect(update.values).toEqual(expect.objectContaining({
      title: 'Senior Product Manager',
      organization: 'Acme',
      start_date: '2020-01-01',
      end_date: '2022-06-30',
    }))
  })

  it('deletes only after confirmation, then returns to the experience list', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Product Manager', level: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Experience settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete experience' }))
    expect(db.calls.some((call) => call.action === 'delete')).toBe(false)

    const confirm = screen.getByRole('dialog', { name: 'Confirm action' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Experience list')).toBeInTheDocument()
    expect(db.calls.filter((call) => call.action === 'delete')).toEqual([{ table: 'experience', action: 'delete', values: undefined }])
  })
})
