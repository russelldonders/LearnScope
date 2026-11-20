import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LearnerWorkspaceSettingsPage from './LearnerWorkspaceSettingsPage'
import { normaliseWorkspaceSettings } from '../../lib/learnerWorkspaceSettings'

vi.mock('../../context/LanguageContext', () => import('../../test/languageMock'))
vi.mock('../../components/AppHeader', () => ({ default: () => <div data-testid="app-header" /> }))

const authMock = vi.hoisted(() => vi.fn())
const getSettingsMock = vi.hoisted(() => vi.fn())
const saveSettingsMock = vi.hoisted(() => vi.fn())

vi.mock('../../context/AuthContext', () => ({ useAuth: authMock }))
// A stand-in for the course page editor: shows what it was opened with and
// saves a fixed page through the caller's saveResource, as the real one does.
const editorSaveMock = vi.hoisted(() => ({ title: 'Benefits', document: null }))
vi.mock('../../components/PageBuilderModal', () => ({
  default: ({ resource, saveResource, onSaved, onClose }) => (
    <div role="dialog" aria-label="Page editor">
      <p>Editing {resource.title} with {resource.page_content.blocks.length} blocks</p>
      <p role="alert" data-testid="editor-error" />
      <button
        type="button"
        onClick={async () => {
          try {
            const saved = await saveResource(editorSaveMock.title, editorSaveMock.document)
            onSaved(saved)
            onClose()
          } catch (err) {
            document.querySelector('[data-testid="editor-error"]').textContent = err.message
          }
        }}
      >
        Save page
      </button>
    </div>
  ),
}))
vi.mock('../../lib/admin/organisations', () => ({
  getOrganisation: () => Promise.resolve({ id: 'org-1', name: 'Acme Ltd', brand_primary_color: '#123456' }),
}))
vi.mock('../../lib/learnerWorkspaceSettings', async (importOriginal) => ({
  ...(await importOriginal()),
  getLearnerWorkspaceSettings: getSettingsMock,
  saveLearnerWorkspaceSettings: saveSettingsMock,
}))

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/organisation/organisations/org-1/learner-workspace']}>
      <Routes>
        <Route path="/organisation/organisations/:organisationId/learner-workspace" element={<LearnerWorkspaceSettingsPage />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  authMock.mockReturnValue({ employerMemberships: [{ employer_id: 'org-1', role: 'admin' }], organisationMemberships: [], isPlatformAdmin: false })
  getSettingsMock.mockResolvedValue(normaliseWorkspaceSettings(null))
  saveSettingsMock.mockImplementation((_id, settings) => Promise.resolve(settings))
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('LearnerWorkspaceSettingsPage', () => {
  it('turns away someone who is not an admin of this organisation', () => {
    authMock.mockReturnValue({ employerMemberships: [{ employer_id: 'org-1', role: 'member' }], organisationMemberships: [], isPlatformAdmin: false })
    renderPage()
    expect(screen.getByRole('alert')).toHaveTextContent('Only an administrator of this organisation')
    expect(getSettingsMock).not.toHaveBeenCalled()
  })

  it('lets an organisation admin in', async () => {
    authMock.mockReturnValue({ employerMemberships: [], organisationMemberships: [{ organisation_id: 'org-1', role: 'admin' }], isPlatformAdmin: false })
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Learner workspace' })).toBeInTheDocument()
  })

  it('previews hidden, renamed and reordered sections before saving them', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Learner workspace' })
    const preview = screen.getByRole('region', { name: 'Member workspace preview' })
    const previewTabs = () => within(preview).getAllByRole('button').map((button) => button.textContent)
    expect(previewTabs()).toEqual(['Home', 'My learning', 'Catalogue', 'Role & skills'])
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Show Role & skills' }))
    fireEvent.change(screen.getAllByRole('textbox', { name: 'Name shown to members (optional)' })[1], { target: { value: 'My development' } })
    fireEvent.click(screen.getByRole('button', { name: 'Move Catalogue up' }))
    expect(previewTabs()).toEqual(['Home', 'Catalogue', 'My development'])

    fireEvent.change(screen.getByRole('textbox', { name: 'Announcement' }), { target: { value: 'New starters: begin here.' } })
    expect(within(preview).getByText('New starters: begin here.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: /Browse only/ }))
    fireEvent.click(within(preview).getByRole('button', { name: 'Catalogue' }))
    expect(within(preview).getByText('Courses from your catalogues appear here, without an Enrol button.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Saved.')
    expect(saveSettingsMock).toHaveBeenCalledWith('org-1', expect.objectContaining({
      sectionOrder: ['home', 'catalogue', 'learning', 'role'],
      hiddenSections: ['role'],
      sectionLabels: { learning: 'My development' },
      announcement: 'New starters: begin here.',
      catalogueEnrolment: 'browse_only',
    }))
  })

  it('adds an empty section of the admin’s own, which they can name, fill and delete', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Learner workspace' })
    const preview = screen.getByRole('region', { name: 'Member workspace preview' })

    fireEvent.click(screen.getByRole('button', { name: 'Add a section' }))
    const nameField = screen.getByRole('textbox', { name: 'Section name' })
    expect(nameField).toHaveValue('New section')
    expect(screen.getByText('Empty. Members see “Nothing has been added here yet.”')).toBeInTheDocument()

    fireEvent.click(within(preview).getByRole('button', { name: 'New section' }))
    expect(within(preview).getByText('Nothing has been added here yet.')).toBeInTheDocument()

    // A scored question is turned away by the editor's save.
    editorSaveMock.title = 'Quiz'
    editorSaveMock.document = { version: 1, blocks: [{ id: 'q', type: 'test_question', title: 'Q', items: [] }] }
    fireEvent.click(screen.getByRole('button', { name: 'Edit page: New section' }))
    expect(screen.getByText('Editing New section with 0 blocks')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save page' }))
    expect(await screen.findByText(/can’t have scored questions/)).toBeInTheDocument()

    editorSaveMock.title = 'Benefits'
    editorSaveMock.document = { version: 1, blocks: [{ id: 'b1', type: 'text', content: 'Pension details' }] }
    fireEvent.click(screen.getByRole('button', { name: 'Save page' }))
    expect(await screen.findByRole('status')).toHaveTextContent('“Benefits” updated. Save changes to publish it to members.')
    expect(screen.queryByRole('dialog', { name: 'Page editor' })).not.toBeInTheDocument()
    expect(nameField).toHaveValue('Benefits')
    expect(screen.getByText('1 block')).toBeInTheDocument()
    fireEvent.click(within(preview).getByRole('button', { name: 'Benefits' }))
    expect(within(preview).getByText('Pension details')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await screen.findByText(/^Saved\./)
    const saved = saveSettingsMock.mock.calls[0][1]
    expect(saved.customPages).toEqual([{ id: expect.stringMatching(/^page-/), title: 'Benefits', content: { version: 1, blocks: [{ id: 'b1', type: 'text', content: 'Pension details' }] } }])
    expect(saved.sectionOrder.at(-1)).toBe(saved.customPages[0].id)

    fireEvent.click(screen.getByRole('button', { name: 'Delete Benefits' }))
    expect(screen.getByText(/Delete the “Benefits” section and its content\?/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete section' }))
    expect(screen.queryByRole('textbox', { name: 'Section name' })).not.toBeInTheDocument()
    expect(within(preview).queryByRole('button', { name: 'Benefits' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
  })

  it('stops a link without an https address from being saved', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Learner workspace' })

    fireEvent.click(screen.getByRole('button', { name: 'Add link' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Link 1 name' }), { target: { value: 'Handbook' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Link 1 address' }), { target: { value: 'http://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Link 1 needs a full web address starting with https://')
    expect(saveSettingsMock).not.toHaveBeenCalled()
  })
})
