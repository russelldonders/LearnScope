import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MyTeam from './MyTeam'

vi.mock('../lib/employerManagement', () => ({
  assignCourseToManagedEmployerMember: vi.fn(),
  confirmManagedEmployerSkillLevel: vi.fn(),
  getMyEmployerTeamMemberSnapshot: vi.fn(),
  listManagerAssignableCourses: vi.fn(),
  listManagerSuggestibleSkills: vi.fn(),
  listMyEmployerTeam: vi.fn(),
  suggestSkillToManagedEmployerMember: vi.fn(),
}))

const authState = {
  managerContexts: [{
    employerId: 'employer-1', employerName: 'Acme', employerSlug: 'acme',
    directReportCount: 1, indirectReportCount: 1,
  }],
  managerContextsError: null,
  refreshManagerContexts: vi.fn(),
}

vi.mock('../context/AuthContext', () => ({ useAuth: () => authState }))
vi.mock('../components/AppHeader', () => ({ default: () => <header>LearnScope navigation</header> }))

function buildServices(overrides = {}) {
  return {
    listMyEmployerTeam: vi.fn().mockResolvedValue([
      {
        employeeMemberId: 'member-1', employeeUserId: 'user-1', fullName: 'Alex Morgan', avatarUrl: null,
        reportDepth: 1, accessScope: ['employment', 'training_assignments'],
        relationshipTypes: ['primary'], isPrimary: true,
      },
      {
        employeeMemberId: 'member-2', employeeUserId: 'user-2', fullName: 'Sam Lee', avatarUrl: null,
        reportDepth: 2, accessScope: ['employment'], relationshipTypes: ['indirect'], isPrimary: false,
      },
    ]),
    getMyEmployerTeamMemberSnapshot: vi.fn().mockResolvedValue({
      employeeMemberId: 'member-1', employeeUserId: 'user-1', fullName: 'Alex Morgan', avatarUrl: null,
      reportDepth: 1, accessScope: ['employment', 'training_assignments', 'skill_management', 'shared_skills'],
      relationshipTypes: ['primary'], isPrimary: true,
      employmentFields: [{ id: 'field-1', label: 'Job title', value: 'Engineer' }],
      roleAssignments: [],
      trainingAssignments: [{ id: 'assignment-1', name: 'Safety', status: 'assigned', assignedAt: '2026-09-21' }],
      skillSuggestions: [],
      skillConfirmations: [],
      sharedSkills: [{ id: 'skill-1', name: 'Shared SQL', category: 'Technical', level: 4, evidenceVisible: false }],
    }),
    listManagerAssignableCourses: vi.fn().mockResolvedValue([{ id: 'course-1', name: 'Manager essentials' }]),
    listManagerSuggestibleSkills: vi.fn().mockResolvedValue([{ id: 'library-1', name: 'Coaching' }]),
    assignCourseToManagedEmployerMember: vi.fn().mockResolvedValue('assignment-2'),
    suggestSkillToManagedEmployerMember: vi.fn().mockResolvedValue('suggestion-1'),
    confirmManagedEmployerSkillLevel: vi.fn().mockResolvedValue('confirmation-1'),
    ...overrides,
  }
}

function renderRoute(path, services) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/team" element={<MyTeam services={services} />} />
        <Route path="/team/:employeeMemberId" element={<MyTeam services={services} />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  authState.managerContexts = [{
    employerId: 'employer-1', employerName: 'Acme', employerSlug: 'acme',
    directReportCount: 1, indirectReportCount: 1,
  }]
  authState.managerContextsError = null
})

afterEach(cleanup)

describe('My Team', () => {
  it('shows direct and indirect reports without presenting a learner profile', async () => {
    const services = buildServices()
    renderRoute('/team?employer=employer-1', services)

    expect(await screen.findByRole('heading', { name: 'My team' })).toBeInTheDocument()
    expect(screen.getByText('Alex Morgan')).toBeInTheDocument()
    expect(screen.getByText('Sam Lee')).toBeInTheDocument()
    expect(screen.getAllByText('Primary')).toHaveLength(1)
    expect(screen.getAllByText('Indirect')).not.toHaveLength(0)
    expect(screen.getByText(/never opens a person’s full LearnScope profile/i)).toBeInTheDocument()
    expect(services.listMyEmployerTeam).toHaveBeenCalledWith('employer-1')
  })

  it('filters the team between direct and indirect reports', async () => {
    renderRoute('/team?employer=employer-1', buildServices())
    await screen.findByText('Alex Morgan')

    fireEvent.click(screen.getByRole('button', { name: 'Indirect' }))
    expect(screen.queryByText('Alex Morgan')).not.toBeInTheDocument()
    expect(screen.getByText('Sam Lee')).toBeInTheDocument()
  })

  it('renders only the strict member snapshot and performs a scoped training action', async () => {
    const services = buildServices()
    renderRoute('/team/member-1?employer=employer-1', services)

    expect(await screen.findByRole('heading', { name: 'Alex Morgan' })).toBeInTheDocument()
    expect(screen.getByText('Engineer')).toBeInTheDocument()
    expect(screen.getByText('Shared SQL')).toBeInTheDocument()
    expect(screen.queryByText('Private Writing')).not.toBeInTheDocument()
    expect(screen.getByText(/Evidence not in your scope/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Employer training'), { target: { value: 'course-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Assign training' }))

    await waitFor(() => expect(services.assignCourseToManagedEmployerMember).toHaveBeenCalledWith(
      'employer-1', 'member-1', 'course-1'
    ))
    expect(await screen.findByText('Training assigned.')).toBeInTheDocument()
  })

  it('does not render actions outside the relationship scope', async () => {
    const services = buildServices({
      getMyEmployerTeamMemberSnapshot: vi.fn().mockResolvedValue({
        employeeMemberId: 'member-2', fullName: 'Sam Lee', reportDepth: 1,
        accessScope: ['employment'], relationshipTypes: ['functional'], isPrimary: false,
        employmentFields: [], roleAssignments: [], trainingAssignments: [],
        skillSuggestions: [], skillConfirmations: [], sharedSkills: [],
      }),
    })
    renderRoute('/team/member-2?employer=employer-1', services)

    expect(await screen.findByRole('heading', { name: 'Sam Lee' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Manager actions' })).not.toBeInTheDocument()
    expect(services.listManagerAssignableCourses).not.toHaveBeenCalled()
    expect(services.listManagerSuggestibleSkills).not.toHaveBeenCalled()
  })
})
