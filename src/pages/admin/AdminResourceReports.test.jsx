import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const lib = vi.hoisted(() => ({
  adminListResourceReports: vi.fn(),
  adminResolveResourceReports: vi.fn(),
  getResourceFileUrl: vi.fn(),
}))

vi.mock('../../lib/skillResources', () => lib)
vi.mock('./AdminLayout', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('../../context/LanguageContext', async () => {
  const { english } = await import('../../lib/i18n/translations')
  const t = (key) => key.split('.').reduce((v, part) => v?.[part], english) ?? key
  return { useLanguage: () => ({ language: 'en', setLanguage: vi.fn(), t }) }
})

const { default: AdminResourceReports } = await import('./AdminResourceReports')

const report = {
  resource_id: 'r1',
  kind: 'link',
  title: 'Cheap courses!!',
  url: 'https://spam.example.com',
  note: null,
  audience: 'skill_public',
  skill_name: 'Python',
  owner_label: 'Sam Smith',
  report_count: 2,
  reasons: ['spam', 'misleading'],
  details: ['An advert'],
  first_reported_at: '2026-11-15T10:00:00Z',
}

beforeEach(() => {
  lib.adminListResourceReports.mockResolvedValueOnce([report]).mockResolvedValue([])
  lib.adminResolveResourceReports.mockResolvedValue()
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AdminResourceReports', () => {
  it('lists reported resources with who shared them and why', async () => {
    render(<AdminResourceReports />)
    expect(await screen.findByRole('link', { name: 'Cheap courses!!' })).toHaveAttribute('href', 'https://spam.example.com')
    expect(screen.getByText('2 reports')).toBeInTheDocument()
    expect(screen.getByText('Sam Smith')).toBeInTheDocument()
    expect(screen.getByText('Everyone tracking the skill')).toBeInTheDocument()
    expect(screen.getByText('Spam or advertising · Wrong or misleading')).toBeInTheDocument()
    expect(screen.getByText('“An advert”')).toBeInTheDocument()
  })

  it('removes a resource from sharing only after confirming', async () => {
    render(<AdminResourceReports />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove from sharing' }))
    expect(lib.adminResolveResourceReports).not.toHaveBeenCalled()
    const buttons = screen.getAllByRole('button', { name: 'Remove from sharing' })
    fireEvent.click(buttons[buttons.length - 1])
    await waitFor(() => expect(lib.adminResolveResourceReports).toHaveBeenCalledWith('r1', 'remove'))
    expect(await screen.findByText('“Cheap courses!!” was removed from sharing.')).toBeInTheDocument()
    expect(screen.getByText('No open reports.')).toBeInTheDocument()
  })
})
