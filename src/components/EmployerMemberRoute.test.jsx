import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EmployerMemberRoute from './EmployerMemberRoute'

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    needsOnboarding: false,
    needsName: false,
    employerMemberships: [],
  }),
}))

vi.mock('../context/LanguageContext', () => ({ useLanguage: () => ({ t: (key) => key }) }))
vi.mock('../lib/employerRoleProfiles', () => ({ getEmployerLoginContext: vi.fn() }))

function LoginDestination() {
  const location = useLocation()
  return <p>Login destination: {location.search}</p>
}

afterEach(cleanup)

describe('EmployerMemberRoute', () => {
  it('preserves the organisation when a logged-out learner follows the LMS link', async () => {
    render(
      <MemoryRouter initialEntries={['/employer/home?org=acme']}>
        <Routes>
          <Route
            path="/employer/home"
            element={<EmployerMemberRoute><p>Learner LMS</p></EmployerMemberRoute>}
          />
          <Route path="/login" element={<LoginDestination />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Login destination: ?org=acme')).toBeInTheDocument()
  })
})
