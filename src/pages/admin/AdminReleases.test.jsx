import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AdminReleases from './AdminReleases'
import {
  addChangelogEntry,
  deleteChangelogEntry,
  listPendingChangelogEntries,
  listPlatformReleases,
  updateChangelogEntry,
} from '../../lib/admin/platformReleases'

// AdminLayout pulls in AppHeader, which needs Auth/Language/PendingActions/
// NavVisibility context providers this test isn't otherwise exercising --
// stubbed as a passthrough so the test can focus on AdminReleases' own
// behaviour instead of standing up every context AppHeader happens to need.
vi.mock('./AdminLayout', () => ({
  default: ({ children }) => <div>{children}</div>,
}))

vi.mock('../../lib/admin/platformReleases', () => ({
  addChangelogEntry: vi.fn(),
  deleteChangelogEntry: vi.fn(),
  listPendingChangelogEntries: vi.fn(),
  listPlatformReleases: vi.fn(),
  updateChangelogEntry: vi.fn(),
}))

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  listPendingChangelogEntries.mockResolvedValue([])
  listPlatformReleases.mockResolvedValue([])
})

function renderPage() {
  return render(<MemoryRouter><AdminReleases /></MemoryRouter>)
}

describe('AdminReleases', () => {
  it('shows an empty state with nothing pending and no releases yet', async () => {
    renderPage()
    expect(await screen.findByText('Nothing pending yet.')).toBeInTheDocument()
    expect(screen.getByText('No releases confirmed yet.')).toBeInTheDocument()
  })

  it('lists pending entries', async () => {
    listPendingChangelogEntries.mockResolvedValue([
      { id: 'e1', summary: 'Added the cohort date-only option', created_at: '2026-09-13T00:00:00Z' },
    ])
    renderPage()
    expect(await screen.findByText('Added the cohort date-only option')).toBeInTheDocument()
  })

  it('adds a new pending entry', async () => {
    renderPage()
    await screen.findByText('Nothing pending yet.')
    fireEvent.change(screen.getByPlaceholderText('What changed?'), { target: { value: 'Fixed the cohort form' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(addChangelogEntry).toHaveBeenCalledWith('Fixed the cohort form'))
  })

  it('removes a pending entry', async () => {
    listPendingChangelogEntries.mockResolvedValue([
      { id: 'e1', summary: 'Something shipped', created_at: '2026-09-13T00:00:00Z' },
    ])
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(deleteChangelogEntry).toHaveBeenCalledWith('e1'))
  })

  it('edits a pending entry in place', async () => {
    listPendingChangelogEntries.mockResolvedValue([
      { id: 'e1', summary: 'Original wording', created_at: '2026-09-13T00:00:00Z' },
    ])
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const input = screen.getByDisplayValue('Original wording')
    fireEvent.change(input, { target: { value: 'Better wording' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(updateChangelogEntry).toHaveBeenCalledWith('e1', 'Better wording'))
  })

  it('shows release history with its bundled entries', async () => {
    listPlatformReleases.mockResolvedValue([
      {
        id: 'r1', version: 3, notes: 'A good release', releasedAt: '2026-09-10T00:00:00Z',
        entries: [{ id: 'e1', summary: 'Did a thing' }],
      },
    ])
    renderPage()
    expect(await screen.findByText('Version 3')).toBeInTheDocument()
    expect(screen.getByText('A good release')).toBeInTheDocument()
    expect(screen.getByText('Did a thing')).toBeInTheDocument()
  })
})
