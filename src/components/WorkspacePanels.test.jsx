import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PageContent from './PageContent'
import { GoalsPanel, SampleGoalsPanel, SkillsPanel } from './WorkspacePanels'
import { listOrganisationGoals, listOrganisationSkills } from '../lib/workspacePanels'

vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('../context/LanguageContext', () => import('../test/languageMock'))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../lib/workspacePanels', () => ({ listOrganisationGoals: vi.fn(), listOrganisationSkills: vi.fn() }))

const GOALS_BLOCK = { id: 'g', type: 'goals_panel', title: '', limit: 3, show: 'all' }
const SKILLS_BLOCK = { id: 's', type: 'skills_panel', title: 'What we’ve seen', limit: 4 }

beforeEach(() => {
  vi.clearAllMocks()
  listOrganisationGoals.mockResolvedValue([
    { id: 'goal-1', skillName: 'Giving feedback', targetLevel: 3, targetDate: '2027-03-31', status: 'active', currentLevel: 2 },
  ])
  listOrganisationSkills.mockResolvedValue([
    { key: 'skill-1', skillName: 'Data analysis', ratedLevel: 3, ratedAt: '2026-11-01', goalLevel: 4, currentLevel: 3 },
  ])
})

afterEach(cleanup)

describe('organisation workspace panels', () => {
  it('shows the member their goals for this organisation, using the panel’s settings', async () => {
    render(<GoalsPanel block={GOALS_BLOCK} organisationId="org-1" />)
    expect(screen.getByRole('heading', { name: 'Your goals' })).toBeInTheDocument()
    expect(await screen.findByText('Giving feedback')).toBeInTheDocument()
    expect(screen.getByText(/Level 3 \(Capable\) by/)).toBeInTheDocument()
    expect(screen.getByText(/you: Level 2 \(Developing\)/)).toBeInTheDocument()
    expect(listOrganisationGoals).toHaveBeenCalledWith('user-1', 'org-1', { limit: 3, show: 'all' })
  })

  it('shows the member’s skills this organisation rated or set a goal on, under the panel’s own heading', async () => {
    render(<SkillsPanel block={SKILLS_BLOCK} organisationId="org-1" />)
    expect(screen.getByRole('heading', { name: 'What we’ve seen' })).toBeInTheDocument()
    expect(await screen.findByText('Data analysis')).toBeInTheDocument()
    expect(screen.getByText(/rated Level 3 \(Capable\) on .* · goal Level 4 \(Skilled\) · you: Level 3 \(Capable\)/)).toBeInTheDocument()
    expect(listOrganisationSkills).toHaveBeenCalledWith('user-1', 'org-1', { limit: 4, show: undefined })
  })

  it('says so when there is nothing yet, or when loading fails', async () => {
    listOrganisationGoals.mockResolvedValueOnce([])
    render(<GoalsPanel block={GOALS_BLOCK} organisationId="org-1" />)
    expect(await screen.findByText('No goals have been set for you here yet.')).toBeInTheDocument()
    cleanup()
    listOrganisationSkills.mockRejectedValueOnce(new Error('nope'))
    render(<SkillsPanel block={SKILLS_BLOCK} organisationId="org-1" />)
    expect(await screen.findByText(/couldn’t be loaded/)).toBeInTheDocument()
  })

  it('shows made-up rows in the sample, without loading anyone’s records', () => {
    render(<SampleGoalsPanel block={{ ...GOALS_BLOCK, show: 'active' }} />)
    expect(screen.getByText('Example — members see their own')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(listOrganisationGoals).not.toHaveBeenCalled()
  })

  it('draws a panel on a page only where the page supplies one', async () => {
    const document = { version: 1, blocks: [{ id: 't', type: 'text', content: 'Welcome' }, GOALS_BLOCK] }
    render(<PageContent document={document} />)
    expect(screen.getByText('Welcome')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Your goals' })).not.toBeInTheDocument()
    cleanup()
    render(<PageContent document={document} panels={{ goals_panel: GoalsPanel }} panelProps={{ organisationId: 'org-1' }} />)
    expect(await screen.findByText('Giving feedback')).toBeInTheDocument()
    expect(listOrganisationGoals).toHaveBeenCalledWith('user-1', 'org-1', expect.anything())
  })
})
