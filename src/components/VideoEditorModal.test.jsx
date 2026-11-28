import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

function addText(text) {
  fireEvent.click(screen.getByRole('button', { name: 'Add Text' }))
  const entry = screen.getByRole('dialog', { name: 'Type your text' })
  fireEvent.change(within(entry).getByRole('textbox', { name: 'Overlay text' }), { target: { value: text } })
  fireEvent.click(within(entry).getByRole('button', { name: 'Done' }))
}

describe('VideoEditorModal', () => {
  beforeEach(() => {
    updateVideoEdit.mockReset()
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:recording')
    globalThis.URL.revokeObjectURL = vi.fn()
  })
  afterEach(cleanup)

  it('types a caption onto the video, with undo and redo', () => {
    render(<VideoEditorModal resource={resource} onClose={vi.fn()} onSaved={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled()
    addText('Watch the follow-up question')

    expect(screen.queryByRole('dialog', { name: 'Type your text' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Text overlay: Watch the follow-up question/ })).toBeInTheDocument()
    expect(screen.getByText('Edited')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.queryByRole('button', { name: /Text overlay/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    expect(screen.getByRole('button', { name: /Text overlay: Watch the follow-up question/ })).toBeInTheDocument()
  })

  it('adds nothing when the text is left empty', () => {
    render(<VideoEditorModal resource={resource} onClose={vi.fn()} onSaved={vi.fn()} />)
    addText('   ')
    expect(screen.queryByRole('button', { name: /Text overlay/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Edited')).not.toBeInTheDocument()
  })

  it('protects unsaved edits when the user tries to leave', () => {
    const onClose = vi.fn()
    render(<VideoEditorModal resource={resource} onClose={onClose} onSaved={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Stickers' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add 👍 sticker' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }))

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: 'Discard Your Changes?' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Keep Editing' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('opens each tool from the side rail and adds a sticker', () => {
    render(<VideoEditorModal resource={resource} onClose={vi.fn()} onSaved={vi.fn()} />)

    const stickers = screen.getByRole('button', { name: 'Stickers' })
    expect(stickers).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(stickers)
    expect(stickers).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Add 🎯 sticker' }))

    expect(screen.getByRole('button', { name: /Sticker overlay: 🎯/ })).toBeInTheDocument()
    expect(stickers).toHaveAttribute('aria-pressed', 'false')
  })

  it('resizes, turns and deletes the selected overlay from the keyboard', () => {
    render(<VideoEditorModal resource={resource} onClose={vi.fn()} onSaved={vi.fn()} />)
    addText('Key point')
    const overlay = screen.getByRole('button', { name: /Text overlay: Key point/ })

    fireEvent.keyDown(overlay, { key: '+' })
    fireEvent.keyDown(overlay, { key: ']' })
    expect(overlay.style.transform).toBe('translate(-50%, -50%) rotate(15deg) scale(1.1)')

    fireEvent.keyDown(overlay, { key: 'Delete' })
    expect(screen.queryByRole('button', { name: /Text overlay/ })).not.toBeInTheDocument()
  })

  it('applies a filter preset and mutes the sound, then saves them', async () => {
    updateVideoEdit.mockResolvedValue({ ...resource, video_edit: {} })
    const onSaved = vi.fn()
    const onClose = vi.fn()
    render(<VideoEditorModal resource={resource} onClose={onClose} onSaved={onSaved} />)

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    const presets = screen.getByRole('group', { name: 'Filter presets' })
    expect(within(presets).getByRole('button', { name: 'Original' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(presets).getByRole('button', { name: 'Mono' }))
    expect(within(presets).getByRole('button', { name: 'Mono' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Mute' }))
    expect(screen.getByRole('button', { name: 'Mute' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    const saved = updateVideoEdit.mock.calls[0][1]
    expect(saved.muted).toBe(true)
    expect(saved.filter.grayscale).toBe(100)
  })

  it('changes filter with a sideways swipe on the preview', () => {
    render(<VideoEditorModal resource={resource} onClose={vi.fn()} onSaved={vi.fn()} />)
    const preview = screen.getByLabelText(/Video preview/).parentElement

    fireEvent.pointerDown(preview, { clientX: 300, clientY: 100, button: 0 })
    fireEvent.pointerUp(preview, { clientX: 200, clientY: 105, button: 0 })

    expect(screen.getByRole('status')).toHaveTextContent('Vivid')
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    expect(screen.getByRole('button', { name: 'Vivid' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('hands back no edit for a fresh recording used as it is', () => {
    const onApply = vi.fn()
    render(<VideoEditorModal file={new File(['v'], 'take.webm', { type: 'video/webm' })} title="Camera recording" onApply={onApply} onClose={vi.fn()} />)

    expect(screen.getByText('Camera recording')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Use video' }))
    expect(onApply).toHaveBeenCalledWith(null)
    expect(updateVideoEdit).not.toHaveBeenCalled()
  })

  it('hands back the edit made on a fresh recording', () => {
    const onApply = vi.fn()
    render(<VideoEditorModal file={new File(['v'], 'take.webm', { type: 'video/webm' })} onApply={onApply} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Mute' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use video' }))
    expect(onApply.mock.calls[0][0]).toMatchObject({ muted: true })
  })
})
