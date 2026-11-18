import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const lib = vi.hoisted(() => ({
  adminListResourceReports: vi.fn(),
  adminResolveResourceReports: vi.fn(),
  getResourceFileUrl: vi.fn(),
  adminDeleteRemovedPackageFiles: vi.fn(),
  isPackageKind: (kind) => kind === 'scorm' || kind === 'xapi',
  packageLaunchUrl: (r) => `/course-content/${r.package_path}/${r.launch_path}`,
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
  lib.adminDeleteRemovedPackageFiles.mockResolvedValue()
})

const packageReport = {
  ...report,
  kind: 'scorm',
  url: null,
  file_name: 'course.zip',
  package_path: 'learners/u1/r1',
  launch_path: 'index.html',
}

async function removeFromSharing() {
  fireEvent.click(await screen.findByRole('button', { name: 'Remove from sharing' }))
  const buttons = screen.getAllByRole('button', { name: 'Remove from sharing' })
  fireEvent.click(buttons[buttons.length - 1])
}
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

  it('opens a reported package at its launch page', async () => {
    lib.adminListResourceReports.mockReset().mockResolvedValue([{
      ...report,
      kind: 'scorm',
      url: null,
      file_name: 'course.zip',
      package_path: 'learners/u1/r1',
      launch_path: 'index.html',
    }])
    render(<AdminResourceReports />)
    expect(await screen.findByRole('link', { name: 'Cheap courses!!' })).toHaveAttribute('href', '/course-content/learners/u1/r1/index.html')
    expect(screen.getByText('SCORM package · course.zip')).toBeInTheDocument()
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

  it('deletes a removed package\'s files, after warning that it can\'t be undone', async () => {
    lib.adminListResourceReports.mockReset().mockResolvedValueOnce([packageReport]).mockResolvedValue([])
    render(<AdminResourceReports />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove from sharing' }))
    expect(screen.getByText(/delete its package files\? No one, including its owner/)).toBeInTheDocument()
    const buttons = screen.getAllByRole('button', { name: 'Remove from sharing' })
    fireEvent.click(buttons[buttons.length - 1])
    await waitFor(() => expect(lib.adminDeleteRemovedPackageFiles).toHaveBeenCalledWith('learners/u1/r1'))
    // Only after it was removed: storage only lets an admin delete a removed package.
    expect(lib.adminResolveResourceReports.mock.invocationCallOrder[0])
      .toBeLessThan(lib.adminDeleteRemovedPackageFiles.mock.invocationCallOrder[0])
    expect(await screen.findByText('“Cheap courses!!” was removed from sharing and its package files were deleted.')).toBeInTheDocument()
  })

  it('offers to try again when a removed package\'s files couldn\'t be deleted', async () => {
    lib.adminListResourceReports.mockReset().mockResolvedValueOnce([packageReport]).mockResolvedValue([])
    lib.adminDeleteRemovedPackageFiles.mockRejectedValueOnce(new Error('network down')).mockResolvedValue()
    render(<AdminResourceReports />)
    await removeFromSharing()
    expect(await screen.findByText(/couldn’t all be deleted \(network down\)/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try deleting the files again' }))
    await waitFor(() => expect(lib.adminDeleteRemovedPackageFiles).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(/its package files were deleted/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try deleting the files again' })).not.toBeInTheDocument()
  })

  it('leaves files alone for a link that is removed', async () => {
    render(<AdminResourceReports />)
    await removeFromSharing()
    await waitFor(() => expect(lib.adminResolveResourceReports).toHaveBeenCalledWith('r1', 'remove'))
    expect(lib.adminDeleteRemovedPackageFiles).not.toHaveBeenCalled()
  })
})
