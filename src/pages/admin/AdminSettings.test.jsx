import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
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

vi.mock('./AdminReleases', () => ({
  WhatsNewSettingsSection: () => <h2>What's new</h2>,
}))

vi.mock('./AdminActivityLog', () => ({
  AuditLogSettingsSection: () => <h2>Audit log</h2>,
}))

afterEach(cleanup)

describe('AdminSettings', () => {
  it('groups every platform setting on one page with section links', () => {
    render(
      <MemoryRouter initialEntries={['/admin/settings']}>
        <AdminSettings />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'First login journey' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Notification emails' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: "What's new" })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Audit log' })).toBeInTheDocument()

    expect(screen.getByRole('link', { name: 'Notifications' })).toHaveAttribute('href', '#notifications')
    expect(screen.getByRole('link', { name: 'Audit log' })).toHaveAttribute('href', '#audit-log')
  })
})
