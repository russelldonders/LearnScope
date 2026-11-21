import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CourseSections } from './CourseSections'
import {
  createCourseSection,
  listCourseResources,
  listCourseSections,
  reorderContentLinks,
  reorderCourseSections,
} from '../../lib/courseContent'

vi.mock('../../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('../../lib/device', () => ({ useIsDesktop: () => true }))
vi.mock('../../lib/courseContent', () => ({
  listCourseSections: vi.fn(),
  createCourseSection: vi.fn().mockResolvedValue(),
  updateCourseSection: vi.fn(),
  deleteCourseSection: vi.fn(),
  reorderCourseSections: vi.fn().mockResolvedValue(),
  listCourseResources: vi.fn(),
  listOrganisationResources: vi.fn().mockResolvedValue([]),
  linkResourceToCourse: vi.fn(),
  unlinkResourceFromCourse: vi.fn(),
  reorderContentLinks: vi.fn().mockResolvedValue(),
  uploadVideoResource: vi.fn(),
  uploadScreenRecordingResource: vi.fn(),
  uploadFileResource: vi.fn(),
  uploadScormResource: vi.fn(),
  uploadXapiResource: vi.fn(),
  uploadCmi5Resource: vi.fn(),
  addWebResource: vi.fn(),
  addExternalVideoResource: vi.fn(),
  contentFileUrl: vi.fn(),
  listLtiTools: vi.fn().mockResolvedValue([]),
  createLtiResource: vi.fn(),
  saveCoursePageEdit: vi.fn(),
}))

const SECTIONS = [
  { id: 's1', title: 'Getting started', instructions: null, position: 0 },
  { id: 's2', title: 'Going further', instructions: null, position: 1 },
]

// Deliberately out of position order: the outline sorts each section's content.
const ITEMS = [
  { id: 'r2', linkId: 'l2', title: 'Second video', type: 'video', sectionId: 's1', position: 1 },
  { id: 'r1', linkId: 'l1', title: 'First reading', type: 'web', sectionId: 's1', position: 0 },
  { id: 'r3', linkId: 'l3', title: 'Deep dive', type: 'web', sectionId: 's2', position: 0 },
  { id: 'r4', linkId: 'l4', title: 'Loose handout', type: 'file', sectionId: null, position: 0 },
]

const HANDLE_SUFFIX = '. Drag to reorder, or use the arrow keys.'

function renderOutline({ canEdit = true } = {}) {
  render(<CourseSections courseId="course-1" organisationId="org-1" userId="user-1" canEdit={canEdit} />)
}

function sectionHandle(title) {
  return screen.getByRole('button', { name: `Reorder ${title}${HANDLE_SUFFIX}` })
}

function itemHandle(title) {
  return screen.getByRole('button', { name: `Move ${title}${HANDLE_SUFFIX}` })
}

function sectionOrder() {
  return screen
    .getAllByRole('button', { name: /^Reorder / })
    .map((button) => button.getAttribute('aria-label').replace('Reorder ', '').replace(HANDLE_SUFFIX, ''))
}

function titlesIn(listName) {
  return within(screen.getByRole('list', { name: listName }))
    .getAllByRole('listitem')
    .map((li) => li.textContent)
}

beforeEach(() => {
  vi.clearAllMocks()
  listCourseSections.mockResolvedValue(SECTIONS)
  listCourseResources.mockResolvedValue(ITEMS)
})

afterEach(cleanup)

describe('CourseSections', () => {
  it('lists every section open, with its content in position order', async () => {
    renderOutline()
    await screen.findByText('Getting started')
    expect(sectionOrder()).toEqual(['Getting started', 'Going further'])
    expect(titlesIn('Getting started resources')).toEqual(['First reading', 'Second video'])
    expect(titlesIn('Going further resources')).toEqual(['Deep dive'])
  })

  it('shows content without a section under Ungrouped content', async () => {
    renderOutline()
    await screen.findByText('Ungrouped content')
    expect(titlesIn('Ungrouped resources')).toEqual(['Loose handout'])
  })

  it('collapses a section to hide its content', async () => {
    renderOutline()
    fireEvent.click(await screen.findByRole('button', { name: 'Collapse Getting started' }))
    expect(screen.queryByRole('list', { name: 'Getting started resources' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand Getting started' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('list', { name: 'Going further resources' })).toBeInTheDocument()
  })

  it('shows no editing controls when the course cannot be edited', async () => {
    renderOutline({ canEdit: false })
    await screen.findByText('Getting started')
    expect(screen.queryByRole('button', { name: '+ Add section' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Drag to reorder/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Add content to/ })).not.toBeInTheDocument()
  })

  it('shows an empty state when the course has no content', async () => {
    listCourseSections.mockResolvedValue([])
    listCourseResources.mockResolvedValue([])
    renderOutline()
    expect(await screen.findByText(/No sections yet/)).toBeInTheDocument()
    cleanup()
    renderOutline({ canEdit: false })
    expect(await screen.findByText('No content added yet.')).toBeInTheDocument()
  })

  it('adds a section', async () => {
    renderOutline()
    fireEvent.click(await screen.findByRole('button', { name: '+ Add section' }))
    fireEvent.change(screen.getByLabelText('Section title'), { target: { value: 'Wrapping up' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add section' }))
    await waitFor(() => expect(createCourseSection).toHaveBeenCalledWith('course-1', 'Wrapping up'))
    await waitFor(() => expect(screen.queryByLabelText('Section title')).not.toBeInTheDocument())
    expect(listCourseSections).toHaveBeenCalledTimes(2)
  })

  it('moves a section up with the up arrow', async () => {
    renderOutline()
    await screen.findByText('Going further')
    fireEvent.keyDown(sectionHandle('Going further'), { key: 'ArrowUp' })
    await waitFor(() => expect(reorderCourseSections).toHaveBeenCalledTimes(1))
    expect(reorderCourseSections.mock.calls[0][0].map((section) => section.id)).toEqual(['s2', 's1'])
  })

  it('moves a section down with the down arrow', async () => {
    renderOutline()
    await screen.findByText('Getting started')
    fireEvent.keyDown(sectionHandle('Getting started'), { key: 'ArrowDown' })
    await waitFor(() => expect(reorderCourseSections).toHaveBeenCalledTimes(1))
    expect(reorderCourseSections.mock.calls[0][0].map((section) => section.id)).toEqual(['s2', 's1'])
  })

  it('does nothing when the first section is moved up', async () => {
    renderOutline()
    await screen.findByText('Getting started')
    fireEvent.keyDown(sectionHandle('Getting started'), { key: 'ArrowUp' })
    expect(reorderCourseSections).not.toHaveBeenCalled()
  })

  it('moves content up and down within its section with the arrow keys', async () => {
    renderOutline()
    await screen.findByText('Second video')
    fireEvent.keyDown(itemHandle('Second video'), { key: 'ArrowUp' })
    await waitFor(() => expect(reorderContentLinks).toHaveBeenCalledTimes(1))
    expect(reorderContentLinks.mock.calls[0][0].map((item) => item.linkId)).toEqual(['l2', 'l1'])
    expect(reorderContentLinks.mock.calls[0][1]).toBe('s1')

    await waitFor(() => expect(itemHandle('First reading')).not.toBeDisabled())
    fireEvent.keyDown(itemHandle('First reading'), { key: 'ArrowDown' })
    await waitFor(() => expect(reorderContentLinks).toHaveBeenCalledTimes(2))
    expect(reorderContentLinks.mock.calls[1][0].map((item) => item.linkId)).toEqual(['l2', 'l1'])
  })

  it('moves content to the next section with the right arrow and back with the left arrow', async () => {
    renderOutline()
    await screen.findByText('First reading')
    fireEvent.keyDown(itemHandle('First reading'), { key: 'ArrowRight' })
    await waitFor(() => expect(reorderContentLinks).toHaveBeenCalledTimes(2))
    expect(reorderContentLinks.mock.calls[0][0].map((item) => item.linkId)).toEqual(['l3', 'l1'])
    expect(reorderContentLinks.mock.calls[0][1]).toBe('s2')
    expect(reorderContentLinks.mock.calls[1][0].map((item) => item.linkId)).toEqual(['l2'])
    expect(reorderContentLinks.mock.calls[1][1]).toBe('s1')

    reorderContentLinks.mockClear()
    await waitFor(() => expect(itemHandle('Deep dive')).not.toBeDisabled())
    fireEvent.keyDown(itemHandle('Deep dive'), { key: 'ArrowLeft' })
    await waitFor(() => expect(reorderContentLinks).toHaveBeenCalledTimes(2))
    expect(reorderContentLinks.mock.calls[0][0].map((item) => item.linkId)).toEqual(['l1', 'l2', 'l3'])
    expect(reorderContentLinks.mock.calls[0][1]).toBe('s1')
    expect(reorderContentLinks.mock.calls[1]).toEqual([[], 's2'])
  })

  it('restores the order and explains when saving a section reorder fails', async () => {
    reorderCourseSections.mockRejectedValueOnce(new Error('Network down.'))
    renderOutline()
    await screen.findByText('Getting started')
    fireEvent.keyDown(sectionHandle('Going further'), { key: 'ArrowUp' })
    expect(await screen.findByText("Couldn't reorder sections. Network down.")).toBeInTheDocument()
    expect(sectionOrder()).toEqual(['Getting started', 'Going further'])
  })
})
