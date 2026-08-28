import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VideoEditorModal from './VideoEditorModal'

const updateVideoEdit = vi.fn()

vi.mock('../lib/courseContent', () => ({
  contentFileUrl: () => '/training.mp4',
  updateVideoEdit: (...args) => updateVideoEdit(...args),
}))

const resource = {
  id: 'video-1',
  title: 'Customer interview technique',
  video_edit: null,
}

describe('VideoEditorModal', () => {
  beforeEach(() => updateVideoEdit.mockReset())
  afterEach(cleanup)

  it('supports a safe add, undo, and redo workflow', () => {
    render(<VideoEditorModal resource={resource} onClose={vi.fn()} onSaved={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Add Text' }))

    expect(screen.getByText('Edited')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Overlay text' })).toHaveValue('Add text')
    expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.queryByRole('textbox', { name: 'Overlay text' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    expect(screen.getByRole('textbox', { name: 'Overlay text' })).toBeInTheDocument()
  })

  it('protects unsaved edits when the user tries to leave', () => {
    const onClose = vi.fn()
    render(<VideoEditorModal resource={resource} onClose={onClose} onSaved={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add Text' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: 'Discard Your Changes?' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Keep Editing' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('exposes tool and sticker state accessibly', () => {
    render(<VideoEditorModal resource={resource} onClose={vi.fn()} onSaved={vi.fn()} />)

    expect(screen.getByRole('tab', { name: 'Text' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('tab', { name: 'Stickers' }))
    expect(screen.getByRole('tab', { name: 'Stickers' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: 'Add 👍 sticker' })).toBeInTheDocument()
  })
})
