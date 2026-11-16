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

