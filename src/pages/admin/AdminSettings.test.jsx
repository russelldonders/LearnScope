import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AdminSettings from './AdminSettings'

vi.mock('./AdminLayout', () => ({
  default: ({ children }) => <div>{children}</div>,
}))

vi.mock('./AdminOnboarding', () => ({
  OnboardingSettingsSection: () => <h2>First login journey</h2>,
}))

vi.mock('./AdminNotifications', () => ({
  NotificationSettingsSection: () => <h2>Notification emails</h2>,
}))

vi.mock('./AdminMemberFieldSettings', () => ({
  default: () => <h2>Member field settings</h2>,
}))

afterEach(cleanup)

function renderAt(url) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/admin/settings" element={<AdminSettings />} />
        <Route path="/admin/whats-new" element={<p>What's new page</p>} />
        <Route path="/admin/audit-log" element={<p>Audit log page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('AdminSettings', () => {
  it('shows one configuration section at a time, chosen from a side menu', () => {
    renderAt('/admin/settings')
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'First login journey' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Notification emails' })).not.toBeInTheDocument()

    const menu = screen.getByRole('navigation', { name: 'Settings sections' })
    expect(menu).toHaveTextContent('First login journey')
    expect(menu).toHaveTextContent('Member fields')
    expect(menu).toHaveTextContent('Notifications')
    expect(menu).not.toHaveTextContent("What's new")
    expect(menu).not.toHaveTextContent('Audit log')

    fireEvent.click(screen.getByRole('link', { name: /Notifications/ }))
    expect(screen.getByRole('heading', { name: 'Notification emails' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Notifications/ })).toHaveAttribute('aria-current', 'page')
  })

  it('opens the section named in the link', () => {
    renderAt('/admin/settings#member-fields')
    expect(screen.getByRole('heading', { name: 'Member field settings' })).toBeInTheDocument()
  })

  it("sends old What's new and audit log links to their own pages", () => {
    renderAt('/admin/settings#whats-new')
    expect(screen.getByText("What's new page")).toBeInTheDocument()
    cleanup()
    renderAt('/admin/settings#audit-log')
    expect(screen.getByText('Audit log page')).toBeInTheDocument()
  })
})
