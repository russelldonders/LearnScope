import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import PageBuilderModal, { BlockSettingsMenu, MediaEditor } from './PageBuilderModal'
import { createPageResource } from '../lib/courseContent'

vi.mock('../lib/courseContent', () => ({
  contentFileUrl: vi.fn(),
  createPageResource: vi.fn(),
  listOrganisationResources: vi.fn().mockResolvedValue([]),
  removePageMediaAsset: vi.fn(),
  updatePageResource: vi.fn(),
  uploadPageMediaAsset: vi.fn(),
}))

vi.mock('../context/LanguageContext', () => import('../test/languageMock'))
vi.mock('../lib/organisationPlans', () => ({
  listOrganisationPlans: vi.fn().mockResolvedValue([
    { id: '11111111-1111-4111-8111-111111111111', title: 'New manager plan', status: 'active' },
    { id: '22222222-2222-4222-8222-222222222222', title: 'Old plan', status: 'archived' },
  ]),
  listMyPlanAssignments: vi.fn().mockResolvedValue([]),
  respondToPlanAssignment: vi.fn(),
}))

afterEach(cleanup)

const commonProps = {
  onChange: vi.fn(),
  onChangeWithHistory: vi.fn(),
  onUpload: vi.fn(),
  uploading: false,
  libraryResources: [],
  onPickFromLibrary: vi.fn(),
}

it('keeps an uploaded image path out of editable controls and puts its metadata in settings', () => {
  const block = {
    id: 'image-1',
    type: 'image',
    url: '/course-content/org-1/page-media/photo.png',
    storagePath: 'org-1/page-media/photo.png',
    alt: 'Workshop participants',
    caption: 'The opening workshop',
    size: 'large',
  }
  render(<BlockSettingsMenu block={block} {...commonProps} />)

  fireEvent.click(screen.getByRole('button', { name: 'Image settings' }))

  expect(screen.queryByRole('textbox', { name: 'Image URL' })).toBeNull()
  expect(screen.getByRole('textbox', { name: 'Alternative text' })).toHaveValue('Workshop participants')
  expect(screen.getByRole('textbox', { name: 'Caption (optional)' })).toHaveValue('The opening workshop')
  expect(screen.getByText('Uploaded file · path managed by LearnScope')).toBeVisible()
})

it('keeps the source URL editable for externally linked media', () => {
  const block = {
    id: 'video-1',
    type: 'video',
    url: 'https://www.youtube.com/embed/example',
    storagePath: '',
    alt: 'Introduction',
    caption: '',
    size: 'full',
  }
  render(<BlockSettingsMenu block={block} {...commonProps} />)

  fireEvent.click(screen.getByRole('button', { name: 'Video settings' }))
  expect(screen.getByRole('textbox', { name: 'Video URL' })).toHaveValue(block.url)
})

it('shows only the rendered media and real caption on the WYSIWYG canvas once configured', () => {
  render(
    <MediaEditor
      block={{
        id: 'image-1',
        type: 'image',
        url: 'https://example.com/photo.png',
        alt: 'Workshop participants',
        caption: 'The opening workshop',
        size: 'full',
      }}
      {...commonProps}
    />
  )

  expect(screen.getByRole('img', { name: 'Workshop participants' })).toBeVisible()
  expect(screen.getByText('The opening workshop')).toBeVisible()
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(screen.queryByRole('button', { name: /image/i })).toBeNull()
})

it('adds an interactive knowledge check, edits it, and saves it as part of the page', async () => {
  createPageResource.mockResolvedValue({ id: 'page-1' })
  render(<PageBuilderModal organisationId="org-1" userId="me" initialTitle="Listening" onClose={vi.fn()} onSaved={vi.fn()} />)

  const menus = screen.getAllByRole('button', { name: /Add content/ })
  fireEvent.click(menus[menus.length - 1])
  expect(screen.getByText('Interactive and visual')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Knowledge check' }))

  fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), { target: { value: 'What shows you are listening?' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Answer 2' }), { target: { value: 'Checking your phone' } })
  fireEvent.click(screen.getByRole('button', { name: '+ Add answer' }))
  expect(screen.getByRole('textbox', { name: 'Answer 3' })).toBeInTheDocument()

  // Preview shows it as learners will.
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
  expect(screen.getByRole('group', { name: 'What shows you are listening?' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Back to editing/ }))

  fireEvent.click(screen.getByRole('button', { name: 'Save page' }))
  await waitFor(() => expect(createPageResource).toHaveBeenCalled())
  const saved = createPageResource.mock.calls[0][3]
  const check = saved.blocks.find((block) => block.type === 'knowledge_check')
  expect(check).toMatchObject({ title: 'What shows you are listening?', layout: 'single' })
  expect(check.items.map((answer) => answer.label)).toEqual(['Right answer', 'Checking your phone', ''])
  expect(check.items[0].correct).toBe(true)
})

it('lets an author choose how scored questions are presented', async () => {
  const resource = {
    id: 'test-page', title: 'Final test', page_content: { version: 1, test: { passMark: 70 }, blocks: [{
      id: 'q1', type: 'test_question', title: 'Choose one', layout: 'single', points: 1, tolerance: 0,
      items: [{ id: 'a', label: 'A', detail: '', value: 0, correct: true }, { id: 'b', label: 'B', detail: '', value: 0, correct: false }],
    }] },
  }
  render(<PageBuilderModal organisationId="org-1" userId="me" resource={resource} onClose={vi.fn()} onSaved={vi.fn()} />)

  expect(screen.getByRole('combobox', { name: 'Show questions' })).toHaveValue('all')
  fireEvent.change(screen.getByRole('combobox', { name: 'Show questions' }), { target: { value: 'one_at_a_time' } })
  expect(screen.getByRole('combobox', { name: 'Show questions' })).toHaveValue('one_at_a_time')
})

it('asks in an in-app dialog before discarding unsaved changes', () => {
  const onClose = vi.fn()
  const confirmSpy = vi.spyOn(window, 'confirm')
  render(<PageBuilderModal organisationId="org-1" userId="me" initialTitle="Listening" onClose={onClose} onSaved={vi.fn()} />)
  fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Listening well' } })
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(confirmSpy).not.toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
  expect(screen.getByText('Discard unsaved changes to this page?')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
  return waitFor(() => expect(onClose).toHaveBeenCalled()).finally(() => confirmSpy.mockRestore())
})

it('shows the formatting bar only while text is being edited', () => {
  render(<PageBuilderModal organisationId="org-1" userId="me" resource={{ title: 'Bar', page_content: { version: 1, blocks: [{ id: 't1', type: 'text', content: 'Hello' }] } }} onClose={vi.fn()} onSaved={vi.fn()} />)
  expect(screen.queryByRole('toolbar', { name: 'Text formatting' })).not.toBeInTheDocument()

  fireEvent.focusIn(screen.getByRole('textbox', { name: 'Body text' }))
  expect(screen.getByRole('toolbar', { name: 'Text formatting' })).toBeInTheDocument()

  // Tabbing into the bar keeps it open; leaving both closes it.
  const bold = screen.getByRole('button', { name: 'Bold' })
  fireEvent.focusOut(screen.getByRole('textbox', { name: 'Body text' }), { relatedTarget: bold })
  fireEvent.focusIn(bold)
  expect(screen.getByRole('toolbar', { name: 'Text formatting' })).toBeInTheDocument()
  fireEvent.focusOut(bold, { relatedTarget: screen.getByRole('textbox', { name: 'Resource title' }) })
  expect(screen.queryByRole('toolbar', { name: 'Text formatting' })).not.toBeInTheDocument()

  // Other fields, like the page title, don't bring it up.
  fireEvent.focusIn(screen.getByRole('textbox', { name: 'Resource title' }))
  expect(screen.queryByRole('toolbar', { name: 'Text formatting' })).not.toBeInTheDocument()
})

it('explains inline, not in a browser pop-up, where to put a link', () => {
  const alertSpy = vi.spyOn(window, 'alert')
  render(<PageBuilderModal organisationId="org-1" userId="me" resource={{ title: 'Bar', page_content: { version: 1, blocks: [{ id: 't1', type: 'text', content: 'Hello' }] } }} onClose={vi.fn()} onSaved={vi.fn()} />)
  fireEvent.focusIn(screen.getByRole('textbox', { name: 'Body text' }))
  window.getSelection()?.removeAllRanges()
  fireEvent.focusIn(screen.getByRole('textbox', { name: 'Body text' }))
  fireEvent.mouseDown(screen.getAllByRole('button', { name: 'Add link' })[0])
  expect(alertSpy).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toHaveTextContent('Click into some text first (or select the words to link), then add a link.')
  alertSpy.mockRestore()
})

function placeCaret(node, offset) {
  const range = document.createRange()
  range.setStart(node, offset)
  range.collapse(true)
  window.getSelection().removeAllRanges()
  window.getSelection().addRange(range)
}

function selectText(node, start, end) {
  const range = document.createRange()
  range.setStart(node, start)
  range.setEnd(node, end)
  window.getSelection().removeAllRanges()
  window.getSelection().addRange(range)
}

const linkPage = (content) => ({ title: 'Links', page_content: { version: 1, blocks: [{ id: 't1', type: 'text', content }] } })

it('adds a link at the cursor with its own text, opening in the same window', async () => {
  const saveResource = vi.fn().mockResolvedValue({})
  render(<PageBuilderModal organisationId="org-1" userId="me" resource={linkPage('Read the guide')} saveResource={saveResource} onClose={vi.fn()} onSaved={vi.fn()} />)
  const text = screen.getByRole('textbox', { name: 'Body text' })
  placeCaret(text.firstChild, 'Read the guide'.length)
  fireEvent.focusIn(screen.getByRole('textbox', { name: 'Body text' }))
  fireEvent.mouseDown(screen.getAllByRole('button', { name: 'Add link' })[0])

  fireEvent.change(screen.getByLabelText('Web address'), { target: { value: 'https://example.com/guide' } })
  fireEvent.click(screen.getByText('Add link', { selector: 'button[type="submit"]' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Enter the text to show for the link.')

  fireEvent.change(screen.getByLabelText('Text to show'), { target: { value: ' here' } })
  fireEvent.click(screen.getByRole('radio', { name: 'The same window' }))
  fireEvent.click(screen.getByText('Add link', { selector: 'button[type="submit"]' }))

  expect(screen.queryByLabelText('Web address')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /save page/i }))
  await waitFor(() => expect(saveResource).toHaveBeenCalled())
  expect(saveResource.mock.calls[0][1].blocks[0].content).toBe(
    'Read the guide<a href="https://example.com/guide" target="_self" rel="noopener noreferrer">here</a>'
  )
})

it('changes an existing link’s address and window from inside it', async () => {
  const saveResource = vi.fn().mockResolvedValue({})
  render(<PageBuilderModal organisationId="org-1" userId="me" resource={linkPage('See <a href="https://old.example" target="_blank" rel="noopener noreferrer">the policy</a>')} saveResource={saveResource} onClose={vi.fn()} onSaved={vi.fn()} />)
  const anchor = screen.getByRole('textbox', { name: 'Body text' }).querySelector('a')
  placeCaret(anchor.firstChild, 3)
  fireEvent.focusIn(screen.getByRole('textbox', { name: 'Body text' }))
  fireEvent.mouseDown(screen.getAllByRole('button', { name: 'Add link' })[0])

  expect(screen.getByRole('heading', { name: 'Edit link' })).toBeInTheDocument()
  expect(screen.getByLabelText('Web address')).toHaveValue('https://old.example')
  expect(screen.getByRole('radio', { name: 'A new tab' })).toBeChecked()
  expect(screen.queryByLabelText('Text to show')).not.toBeInTheDocument()

  fireEvent.change(screen.getByLabelText('Web address'), { target: { value: 'https://new.example' } })
  fireEvent.click(screen.getByRole('radio', { name: 'The same window' }))
  fireEvent.click(screen.getByRole('button', { name: 'Update link' }))
  fireEvent.click(screen.getByRole('button', { name: /save page/i }))
  await waitFor(() => expect(saveResource).toHaveBeenCalled())
  expect(saveResource.mock.calls[0][1].blocks[0].content).toBe(
    'See <a href="https://new.example" target="_self" rel="noopener noreferrer">the policy</a>'
  )
})

it('offers a new tab by default when linking selected words', () => {
  render(<PageBuilderModal organisationId="org-1" userId="me" resource={linkPage('Read the guide')} saveResource={vi.fn()} onClose={vi.fn()} onSaved={vi.fn()} />)
  const text = screen.getByRole('textbox', { name: 'Body text' })
  selectText(text.firstChild, 9, 14)
  fireEvent.focusIn(screen.getByRole('textbox', { name: 'Body text' }))
  fireEvent.mouseDown(screen.getAllByRole('button', { name: 'Add link' })[0])
  expect(screen.getByRole('heading', { name: 'Add a link' })).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: 'A new tab' })).toBeChecked()
  expect(screen.queryByLabelText('Text to show')).not.toBeInTheDocument()
})

it('offers LearnScope panels only on an organisation’s workspace pages', () => {
  render(<PageBuilderModal organisationId="org-1" userId="me" initialTitle="Listening" onClose={vi.fn()} onSaved={vi.fn()} />)
  const menus = screen.getAllByRole('button', { name: /Add content/ })
  fireEvent.click(menus[menus.length - 1])
  expect(screen.queryByText('From LearnScope')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Goals panel' })).toBeNull()
})

it('adds a goals panel to a workspace page, configures it, and saves its settings only', async () => {
  const saveResource = vi.fn().mockResolvedValue({})
  render(<PageBuilderModal panelBlocks organisationId="org-1" userId="me" resource={{ title: 'Home', page_content: { version: 1, blocks: [] } }} saveResource={saveResource} onClose={vi.fn()} onSaved={vi.fn()} />)

  fireEvent.click(screen.getByRole('button', { name: /Add content/ }))
  expect(screen.getByText('From LearnScope')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Latest skills panel' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Goals panel' }))

  fireEvent.change(screen.getByRole('textbox', { name: 'Panel heading' }), { target: { value: 'Goals from Acme' } })
  fireEvent.change(screen.getByRole('spinbutton', { name: 'How many to show' }), { target: { value: '8' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Which goals' }), { target: { value: 'all' } })
  // The example beside the settings uses made-up rows.
  expect(screen.getByRole('heading', { name: 'Goals from Acme' })).toBeInTheDocument()
  expect(screen.getByText('Example — members see their own')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Save page' }))
  await waitFor(() => expect(saveResource).toHaveBeenCalled())
  expect(saveResource.mock.calls[0][1].blocks).toEqual([
    { id: expect.any(String), type: 'goals_panel', title: 'Goals from Acme', limit: 8, show: 'all' },
  ])
})

it('lets a Plans panel show only chosen organisation plans', async () => {
  const saveResource = vi.fn().mockResolvedValue({})
  render(<PageBuilderModal panelBlocks organisationId="org-1" userId="me" resource={{ title: 'Home', page_content: { version: 1, blocks: [] } }} saveResource={saveResource} onClose={vi.fn()} onSaved={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: /Add content/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Plans panel' }))
  fireEvent.click(await screen.findByRole('checkbox', { name: 'New manager plan' }))
  expect(screen.queryByRole('checkbox', { name: 'Old plan' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Save page' }))
  await waitFor(() => expect(saveResource).toHaveBeenCalled())
  expect(saveResource.mock.calls[0][1].blocks[0]).toMatchObject({ type: 'plans_panel', planIds: ['11111111-1111-4111-8111-111111111111'] })
})
