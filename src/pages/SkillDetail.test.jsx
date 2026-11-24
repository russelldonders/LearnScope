import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SkillDetail from './SkillDetail'
import { LanguageProvider } from '../context/LanguageContext'

// Page-level characterisation tests: they pin down what the skill page shows
// from a given set of records, so its loading code and components can be
// reorganised without changing what the learner sees.

const fixtures = vi.hoisted(() => ({ tables: {} }))
const libraryCalls = vi.hoisted(() => ({ connectionsWithSkill: [] }))
const catalogue = vi.hoisted(() => ({
  enrolInCatalogueCourse: vi.fn(),
  enrolInCourseCohort: vi.fn(),
  listCourseCohorts: vi.fn(),
  removePlannedCourse: vi.fn(),
}))

// Any supabase query resolves to its table's fixture rows: a list read gets
// the array, a single-row read its first row.
vi.mock('../lib/supabaseClient', () => {
  function query(table) {
    const rows = () => fixtures.tables[table] ?? []
    const builder = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') return (resolve, reject) => Promise.resolve({ data: rows(), error: null }).then(resolve, reject)
        if (prop === 'single' || prop === 'maybeSingle') return () => Promise.resolve({ data: rows()[0] ?? null, error: null })
        return () => builder
      },
    })
    return builder
  }
  return {
    supabase: {
      from: query,
      rpc: () => query('__rpc'),
      storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: null, error: null }) }) },
    },
  }
})
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'learner-1', email: 'learner@example.com' } }) }))
vi.mock('../components/AppHeader', () => ({ default: () => null }))
vi.mock('../components/SkillResourcesSection', () => ({ default: () => null }))
vi.mock('../components/SkillGoalsSection', () => ({ default: () => null }))
vi.mock('./CourseLearn', () => ({
  default: ({ courseId, inOverlay }) => <p>{`Lessons for ${courseId}${inOverlay ? ' in overlay' : ''}`}</p>,
}))
vi.mock('../lib/activitySkillLinks', () => ({
  fetchStatementsForSkill: () => Promise.resolve(fixtures.statements ?? []),
  saveActivity: vi.fn(),
}))
vi.mock('../lib/skillTags', () => ({
  listTags: () => Promise.resolve([]),
  listSkillTags: () => Promise.resolve([]),
  addTagToSkill: vi.fn(),
  removeSkillTagLink: vi.fn(),
}))
vi.mock('../lib/skillValidationRequests', () => ({
  listOutgoingValidationRequests: () => Promise.resolve(fixtures.validationRequests ?? []),
}))
vi.mock('../lib/courseCatalogue', async (importOriginal) => ({
  ...(await importOriginal()),
  cancelCourse: vi.fn(),
  listCatalogueCourses: () => Promise.resolve([]),
  listMyCatalogueCourseIds: () => Promise.resolve(new Set()),
  planCatalogueCourse: vi.fn(),
  ...catalogue,
}))
vi.mock('../lib/skillStats', () => ({
  countSkillTrackers: () => Promise.resolve(0),
  listConnectionsWithSkill: (...args) => {
    libraryCalls.connectionsWithSkill.push(args)
    return Promise.resolve([])
  },
}))
vi.mock('../lib/connections', () => ({
  getProfiles: () => Promise.resolve({}),
  listConnections: () => Promise.resolve([]),
}))
vi.mock('../lib/skillComposites', () => ({
  getLearnerCompositeProgress: () => Promise.resolve(null),
  getParentCompositesForSkill: () => Promise.resolve([]),
}))
vi.mock('../lib/managerSkillActions', () => ({
  listTargetsSetByOthers: () => Promise.resolve([]),
  listLatestManagerRatings: () => Promise.resolve([]),
  pickTargetSetByOthers: () => null,
}))
vi.mock('../lib/skillDiscovery', () => ({
  getSearchPrivacySettings: () => Promise.resolve({ skill_search_visibility: 'nobody' }),
  listSearchableSkillIds: () => Promise.resolve(new Set()),
  setSkillSearchable: vi.fn(),
}))
vi.mock('../lib/skillGoals', () => ({ listSkillGoals: () => Promise.resolve([]) }))
vi.mock('../lib/knowledgeLevelGuide', () => ({ ensureKnowledgeLevelGuide: () => Promise.resolve([]) }))
vi.mock('../lib/practicalLevelGuide', () => ({ ensurePracticalLevelGuide: () => Promise.resolve([]) }))

function skillRow(overrides = {}) {
  return {
    id: 'skill-1',
    user_id: 'learner-1',
    name: 'Negotiation',
    category: 'Business',
    level: null,
    knowledge_level: 2,
    lifecycle_stage: 'developing',
    library_skill_id: null,
    next_checkin_date: null,
    date_added: '2024-09-01',
    created_at: '2024-09-01T10:00:00Z',
    knowledge_level_guide: null,
    practical_level_guide: null,
    skill_library: null,
    ...overrides,
  }
}

// Newest first, as the page's query orders them.
const assessments = [
  { id: 'a4', axis: 'practical', level: 3, source: 'self', assessed_at: '2026-03-01T10:00:00Z', created_at: '2026-03-01T10:00:00Z', comments: 'Led two deals' },
  { id: 'a3', axis: 'knowledge', level: 4, source: 'self', assessed_at: '2026-02-01T10:00:00Z', created_at: '2026-02-01T10:00:00Z', comments: null },
  { id: 'a2', axis: 'knowledge', level: 2, source: 'diagnostic_confirmed', assessed_at: '2025-06-01T10:00:00Z', created_at: '2025-06-01T10:00:00Z', comments: null },
  { id: 'a1', axis: 'practical', level: 2, source: 'self', assessed_at: '2025-01-10T10:00:00Z', created_at: '2025-01-10T10:00:00Z', comments: 'First go' },
]

beforeEach(() => {
  fixtures.tables = {
    skills: [skillRow()],
    skill_assessments: assessments,
    skill_peer_ratings: [
      { id: 'r1', rater_id: 'rater-1', rater_name: 'Robin', level: 3, comments: null, rated_at: '2026-04-01T10:00:00Z' },
    ],
    connection_invites: [],
    skill_experience_links: [],
    skill_targets: [],
    skill_course_links: [],
    profiles: [{ id: 'learner-1', full_name: 'Lee Learner', avatar_url: null }],
  }
  fixtures.statements = []
  fixtures.validationRequests = [{ id: 'v1', status: 'pending', validator_id: 'validator-1' }]
  libraryCalls.connectionsWithSkill = []
  catalogue.enrolInCatalogueCourse.mockReset().mockResolvedValue({ id: 'c-planned' })
  catalogue.enrolInCourseCohort.mockReset().mockResolvedValue({ id: 'c-cohort' })
  catalogue.listCourseCohorts.mockReset().mockResolvedValue([])
  catalogue.removePlannedCourse.mockReset().mockResolvedValue()
})

const plannedCourse = {
  id: 'c-planned', name: 'Deal Making', provider: 'Academy', course_type: 'online', duration: '2h',
  completed_date: null, catalogue_course_id: 'cat-1', status: 'planned', cancelled_at: null,
}

afterEach(cleanup)

function renderPage(path = '/skills/skill-1') {
  return render(
    <LanguageProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/skills/:id" element={<SkillDetail />} />
        </Routes>
      </MemoryRouter>
    </LanguageProvider>
  )
}

describe('SkillDetail', () => {
  it('says so when the skill is not one of the learner’s own', async () => {
    fixtures.tables.skills = []
    renderPage()
    expect(await screen.findByText('Skill not found.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
  })

  it('shows the latest practical self-assessment when no level has been evaluated', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Negotiation', level: 1 })).toBeInTheDocument()
    const header = screen.getByRole('heading', { name: 'Negotiation', level: 1 }).closest('div').parentElement
    await waitFor(() => expect(within(header).getByText('Capable')).toBeInTheDocument())
  })

  it('shows an evaluated practical level over a newer self-assessment', async () => {
    fixtures.tables.skills = [skillRow({ level: 4 })]
    renderPage()
    await screen.findByRole('heading', { name: 'Negotiation', level: 1 })
    const header = screen.getByRole('heading', { name: 'Negotiation', level: 1 }).closest('div').parentElement
    expect(within(header).getByText('Skilled')).toBeInTheDocument()
  })

  it('shows a newer knowledge self-assessment alongside the level last confirmed', async () => {
    renderPage()
    const panel = await screen.findByRole('tabpanel')
    await waitFor(() => expect(within(panel).getByText('Knowledgeable')).toBeInTheDocument())
    expect(within(panel).getByText('Self-assessed')).toBeInTheDocument()
    expect(within(panel).getByText('Confirmed')).toBeInTheDocument()
    expect(within(panel).getByText('Aware')).toBeInTheDocument()
  })

  it('counts peer ratings and pending validation requests on the application tab', async () => {
    renderPage('/skills/skill-1?tab=application')
    const panel = await screen.findByRole('tabpanel')
    await waitFor(() => expect(within(panel).getByText(/1 peer rating · 1 request pending/)).toBeInTheDocument())
  })

  it('keeps every dated level in the self-assessment history', async () => {
    renderPage('/skills/skill-1?tab=application')
    const panel = await screen.findByRole('tabpanel')
    await waitFor(() => expect(within(panel).getByText('Capable')).toBeInTheDocument())
    fireEvent.click(within(panel).getByRole('button', { name: 'Self-assess your current level' }))

    const dialog = await screen.findByRole('dialog')
    const items = within(dialog).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Capable')
    expect(items[0]).toHaveTextContent('Led two deals')
    expect(items[1]).toHaveTextContent('Developing')
    expect(items[1]).toHaveTextContent('First go')
  })

  it('opens the skill’s timeline from the history button', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Negotiation', level: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'History' }))
    expect(await screen.findByRole('dialog', { name: 'History' })).toBeInTheDocument()
  })

  it('offers the network tab only for a skill from the shared library', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Negotiation', level: 1 })
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).not.toContain('Skill network')
    expect(libraryCalls.connectionsWithSkill).toHaveLength(0)

    cleanup()
    fixtures.tables.skills = [skillRow({ library_skill_id: 'lib-1' })]
    renderPage()
    await screen.findByRole('heading', { name: 'Negotiation', level: 1 })
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(3))
    expect(libraryCalls.connectionsWithSkill).toEqual([['lib-1', 'learner-1']])
  })

  it('enrols in a planned course right from the skill page, without going to Training', async () => {
    fixtures.tables.skill_course_links = [{ id: 'link-1', relationship: 'developed', created_at: '2026-11-01T10:00:00Z', courses: plannedCourse }]
    renderPage()
    const planned = (await screen.findByRole('heading', { name: 'Planned learning' })).parentElement
    fireEvent.click(within(planned).getByRole('button', { name: 'Enrol' }))
    await waitFor(() => expect(catalogue.enrolInCatalogueCourse).toHaveBeenCalledWith(
      'learner-1',
      { id: 'cat-1', name: 'Deal Making', provider: 'Academy', course_type: 'online', duration: '2h' },
      'skill-1',
    ))
    expect(catalogue.listCourseCohorts).toHaveBeenCalledWith('cat-1')
  })

  it('asks which cohort for a course that runs in cohorts, then takes the planned copy off the plan', async () => {
    fixtures.tables.skill_course_links = [{ id: 'link-1', relationship: 'developed', created_at: '2026-11-01T10:00:00Z', courses: plannedCourse }]
    catalogue.listCourseCohorts.mockResolvedValue([
      { id: 'cohort-1', name: 'Spring run', start_date: '2026-12-01', capacity: null, seatsRemaining: null, enrolment_open: true, sessions: [] },
    ])
    renderPage()
    const planned = (await screen.findByRole('heading', { name: 'Planned learning' })).parentElement
    fireEvent.click(within(planned).getByRole('button', { name: 'Enrol' }))
    const picker = await screen.findByRole('dialog', { name: 'Choose a cohort' })
    expect(catalogue.enrolInCatalogueCourse).not.toHaveBeenCalled()
    fireEvent.click(within(picker).getByRole('button', { name: 'Enrol in this cohort' }))
    await waitFor(() => expect(catalogue.enrolInCourseCohort).toHaveBeenCalledWith('cohort-1', 'skill-1'))
    await waitFor(() => expect(catalogue.removePlannedCourse).toHaveBeenCalledWith('c-planned'))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Choose a cohort' })).not.toBeInTheDocument())
  })

  it('opens an enrolled course over the skill page, and back again', async () => {
    const enrolled = { ...plannedCourse, id: 'c-enrolled', name: 'Closing Deals', status: null }
    fixtures.tables.skill_course_links = [{ id: 'link-2', relationship: 'developed', created_at: '2026-11-01T10:00:00Z', courses: enrolled }]
    renderPage()
    const group = (await screen.findByRole('heading', { name: 'Enrolled' })).parentElement
    fireEvent.click(within(group).getByRole('button', { name: /Closing Deals/ }))
    const overlay = await screen.findByRole('dialog', { name: 'Closing Deals' })
    expect(await within(overlay).findByText('Lessons for c-enrolled in overlay')).toBeInTheDocument()
    fireEvent.click(within(overlay).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog', { name: 'Closing Deals' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Negotiation', level: 1 })).toBeInTheDocument()
  })

  it('lists time in a course package as activity, without calling the level evidence supported', async () => {
    fixtures.tables.skill_peer_ratings = []
    const packageSession = {
      id: 'pkg-session-1',
      recorded_at: '2026-11-18T10:00:00Z',
      created_at: '2026-11-18T10:20:00Z',
      statement: {
        verb: { id: 'http://adlnet.gov/expapi/verbs/experienced', display: { 'en-US': 'Did it' } },
        object: { id: 'https://learnscope.app/xapi/activities/res-1', definition: { name: { 'en-US': 'Fire drill' } } },
        result: { duration: 'PT20M' },
        context: { extensions: {
          'https://learnscope.app/xapi/extensions/provenance': { source: 'package', externalId: 'sess-1' },
          'https://learnscope.app/xapi/extensions/package-session': { resourceId: 'res-1', sessionId: 'sess-1', statementCount: 4, earned: [] },
        } },
      },
    }
    fixtures.statements = [packageSession]
    renderPage('/skills/skill-1?tab=application')
    const panel = await screen.findByRole('tabpanel')
    await waitFor(() => expect(within(panel).getByText(/1 activity logged/)).toBeInTheDocument())
    expect(within(panel).getByText('Fire drill')).toBeInTheDocument()
    expect(within(panel).getByText('Self-assessed')).toBeInTheDocument()
    expect(within(panel).queryByText('Evidence supported')).not.toBeInTheDocument()

    // Something the learner logged themselves does count as evidence.
    cleanup()
    fixtures.statements = [packageSession, {
      id: 'manual-1', recorded_at: '2026-11-17T10:00:00Z', created_at: '2026-11-17T10:00:00Z',
      statement: { verb: { id: 'https://learnscope.app/xapi/verbs/practiced' }, object: { definition: { name: { 'en-US': 'Ran a fire drill' } } } },
    }]
    renderPage('/skills/skill-1?tab=application')
    const again = await screen.findByRole('tabpanel')
    await waitFor(() => expect(within(again).getByText('Evidence supported')).toBeInTheDocument())
  })

  it('opens the knowledge self-assessment from the knowledge tab', async () => {
    renderPage()
    const panel = await screen.findByRole('tabpanel')
    await waitFor(() => expect(within(panel).getByText('Knowledgeable')).toBeInTheDocument())
    fireEvent.click(within(panel).getByRole('button', { name: 'Rate your current level' }))
    expect(await screen.findByRole('dialog', { name: 'Self-assess your knowledge' })).toBeInTheDocument()
  })

  it('opens the quick activity log from the application tab and closes it again', async () => {
    renderPage('/skills/skill-1?tab=application')
    const panel = await screen.findByRole('tabpanel')
    fireEvent.click(await within(panel).findByRole('button', { name: 'Log skill activity' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('opens the skill settings from the header', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Negotiation', level: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Skill settings' }))
    expect(await screen.findByRole('dialog', { name: 'Skill settings' })).toBeInTheDocument()
  })

  it('puts what is due or coming up in the header as cards, ahead of the recommended next action', async () => {
    fixtures.tables.skills = [skillRow({ next_checkin_date: '2020-01-15' })]
    fixtures.tables.skill_targets = [{ id: 't1', skill_id: 'skill-1', target_level: 4, target_date: '2099-03-01', created_at: '2026-01-01T10:00:00Z' }]
    renderPage()
    const selfAssess = await screen.findByRole('region', { name: 'Check in on your level' })
    expect(selfAssess).toHaveTextContent('Self-assessment due')
    expect(within(selfAssess).getByRole('button', { name: 'Self-assess' })).toBeInTheDocument()
    // Targets load after the skill itself.
    const target = await screen.findByRole('region', { name: /^Reach Skilled by .*2099$/ })
    expect(target).toHaveTextContent(/days to go/)
    expect(within(target).getByRole('button', { name: 'View target' })).toBeInTheDocument()

    // Due and coming up first, then the recommended next action, then the tabs.
    const recommended = screen.queryByText('Recommended next action')?.closest('section')
    const order = [selfAssess, target, recommended, screen.getAllByRole('tab')[0]].filter(Boolean)
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  it('shows no upcoming cards when nothing is coming up', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Negotiation', level: 1 })
    expect(screen.queryByRole('region', { name: 'Check in on your level' })).not.toBeInTheDocument()
    expect(screen.queryByText('Your target')).not.toBeInTheDocument()
  })
})
