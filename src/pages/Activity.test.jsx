import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const tables = { xapi_statements: [], skills: [] }
vi.mock('../lib/supabaseClient', () => {
  const query = (table) => {
    const result = () => Promise.resolve({ data: tables[table], error: null })
    const chain = { select: () => chain, eq: () => chain, order: result, then: (ok, fail) => result().then(ok, fail) }
    return chain
  }
  return { supabase: { from: query } }
})
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me', email: 'me@example.com' } }) }))
vi.mock('../components/AppHeader', () => ({ default: () => <header>Header</header> }))
vi.mock('../context/LanguageContext', async () => {
  const { english } = await import('../lib/i18n/translations')
  const t = (key, params) => {
    const value = key.split('.').reduce((v, part) => v?.[part], english) ?? key
    return params ? value.replace(/\{(\w+)\}/g, (m, name) => (name in params ? params[name] : m)) : value
  }
  return { useLanguage: () => ({ language: 'en', setLanguage: vi.fn(), t }) }
})

const { default: Activity } = await import('./Activity')
const { SKILL_EXTENSION_IRI } = await import('../lib/xapiStatement')

afterEach(cleanup)

const running = { id: 'skill-run', name: 'Running' }
function activity(id, daysAgo, verb = 'practiced') {
  const when = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString()
  const iri = verb === 'practiced' ? 'https://learnscope.app/xapi/verbs/practiced' : 'http://adlnet.gov/expapi/verbs/completed'
  return {
    id,
    recorded_at: when,
    created_at: when,
    resource_id: null,
    statement: {
      verb: { id: iri, display: { 'en-US': verb } },
      object: { definition: { name: { 'en-US': id } } },
      context: { extensions: { [SKILL_EXTENSION_IRI]: [running] } },
    },
  }
}

function DashboardStub() {
  const location = useLocation()
  return <p>Dashboard with {location.state?.logAgainRow?.id}</p>
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/activity']}>
      <Routes>
        <Route path="/activity" element={<Activity />} />
        <Route path="/dashboard" element={<DashboardStub />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  tables.skills = [running]
  tables.xapi_statements = []
})

describe('Activity page', () => {
  it('shows activities as a day-by-day timeline', async () => {
    tables.xapi_statements = [activity('Evening run', 0), activity('Hill sprints', 1), activity('Long run', 1)]
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Today · 1 activity' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Yesterday · 2 activities' })).toBeInTheDocument()
    expect(screen.getByText('Showing 3 of 3 activities')).toBeInTheDocument()
  })

  it('filters by type using plain verbs', async () => {
    tables.xapi_statements = [activity('Evening run', 0), activity('Marathon', 2, 'completed')]
    renderPage()
    await screen.findByText('Evening run')
    fireEvent.click(screen.getByRole('button', { name: 'Finished' }))
    expect(screen.getByRole('button', { name: 'Finished' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('Evening run')).not.toBeInTheDocument()
    expect(screen.getByText('Marathon')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Any type' }))
    expect(screen.getByText('Evening run')).toBeInTheDocument()
  })

  it('loads long histories in pages', async () => {
    tables.xapi_statements = Array.from({ length: 45 }, (_, i) => activity(`Run ${i}`, i))
    renderPage()
    await screen.findByText('Run 0')
    expect(screen.queryByText('Run 44')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show 5 more' }))
    expect(screen.getByText('Run 44')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Show \d+ more$/ })).not.toBeInTheDocument()
  })

  it('takes Log again to the dashboard with the activity', async () => {
    tables.xapi_statements = [activity('Evening run', 0)]
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Log again' }))
    expect(screen.getByText('Dashboard with Evening run')).toBeInTheDocument()
  })
})
