import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AdminUserDetail from './AdminUserDetail'

const adminUsersMock = vi.hoisted(() => ({
  getUserProfile: vi.fn(),
  startUserImpersonation: vi.fn(),
}))

vi.mock('../../lib/admin/users', () => adminUsersMock)
vi.mock('./AdminLayout', () => ({ default: ({ children }) => <main>{children}</main> }))

const profile = {
  profile: {
    id: 'target-1',
    firstName: 'Alex',
    lastName: 'Morgan',
    email: 'alex@example.com',
    userCode: 'USR-00001',
    accountStatus: 'active',
    createdAt: '2026-01-01T00:00:00Z',
    lastSignInAt: null,
  },
  isPlatformAdmin: false,
  organisationMemberships: [],
  skills: [],
  courses: [],
  experience: [],
  connections: [],
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/users/target-1']}>
      <Routes>
        <Route path="/admin/users/:userId" element={<AdminUserDetail />} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  adminUsersMock.getUserProfile.mockReset()
  adminUsersMock.startUserImpersonation.mockReset()
})

describe('AdminUserDetail user preview', () => {
  it('requires an audit reason and opens the returned session in a separate window', async () => {
    adminUsersMock.getUserProfile.mockResolvedValue(profile)
    const session = {
      sessionId: 'preview-1',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      targetName: 'Alex Morgan',
      targetEmail: 'alex@example.com',
      expiresAt: '2026-11-16T16:00:00Z',
    }
    adminUsersMock.startUserImpersonation.mockResolvedValue(session)
    const previewWindow = {
      document: { title: '', body: { textContent: '' } },
      sessionStorage: { setItem: vi.fn() },
      location: { replace: vi.fn() },
      close: vi.fn(),
    }
    vi.spyOn(window, 'open').mockReturnValue(previewWindow)

    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Preview as user' }))

    const submit = screen.getByRole('button', { name: 'Open preview' })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Reason for access'), {
      target: { value: 'Investigating support ticket LS-1042' },
    })
    fireEvent.click(submit)

    await waitFor(() => expect(adminUsersMock.startUserImpersonation).toHaveBeenCalledWith(
      'target-1',
      'Investigating support ticket LS-1042',
    ))
    expect(previewWindow.sessionStorage.setItem).toHaveBeenCalledWith(
      'learnscope:impersonation-bootstrap',
      JSON.stringify(session),
    )
    expect(previewWindow.location.replace).toHaveBeenCalledWith('/dashboard')
  })

  it('does not offer a preview for platform administrators', async () => {
    adminUsersMock.getUserProfile.mockResolvedValue({ ...profile, isPlatformAdmin: true })
    renderPage()
    expect(await screen.findByRole('button', { name: 'Preview as user' })).toBeDisabled()
  })
})

