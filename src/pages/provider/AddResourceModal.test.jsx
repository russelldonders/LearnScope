import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AddResourceModal } from './AddResourceModal'

const uploadVideoResource = vi.fn()
const updateVideoEdit = vi.fn()
const linkResourceToCourse = vi.fn()

vi.mock('../../lib/courseContent', () => ({
  linkResourceToCourse: (...args) => linkResourceToCourse(...args),
  uploadVideoResource: (...args) => uploadVideoResource(...args),
  uploadScreenRecordingResource: vi.fn(),
  uploadFileResource: vi.fn(),
  uploadScormResource: vi.fn(),
  uploadXapiResource: vi.fn(),
  uploadCmi5Resource: vi.fn(),
  addWebResource: vi.fn(),
  addExternalVideoResource: vi.fn(),
  listLtiTools: vi.fn(async () => []),
  createLtiResource: vi.fn(),
  updateVideoEdit: (...args) => updateVideoEdit(...args),
}))

// The camera itself is covered in CameraRecorderModal.test.jsx; here it just
// hands back a recording and the edit made on it.
const recordedEdit = { trimStart: 1, trimEnd: 4, muted: true, overlays: [] }
vi.mock('../../components/CameraRecorderModal', () => ({
  default: ({ onRecorded, onClose }) => (
    <button
      type="button"
      onClick={() => {
        onRecorded(new File(['v'], 'camera-recording.webm', { type: 'video/webm' }), { edit: recordedEdit })
        onClose()
      }}
    >
      Finish camera recording
    </button>
  ),
}))

// jsdom has no DataTransfer and only takes a real FileList on file inputs.
let filesByInput
beforeEach(() => {
  filesByInput = new WeakMap()
  globalThis.DataTransfer = class {
    constructor() {
      this.list = []
      this.items = { add: (file) => this.list.push(file) }
    }
    get files() {
      return this.list
    }
  }
  Object.defineProperty(HTMLInputElement.prototype, 'files', {
    configurable: true,
    get() { return filesByInput.get(this) ?? [] },
    set(value) { filesByInput.set(this, value) },
  })
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn() } })
  globalThis.MediaRecorder = class {}
  uploadVideoResource.mockReset().mockResolvedValue({ id: 'new-video' })
  updateVideoEdit.mockReset().mockResolvedValue({})
  linkResourceToCourse.mockReset().mockResolvedValue({})
})

afterEach(() => {
  cleanup()
  delete HTMLInputElement.prototype.files
})

function renderModal() {
  render(
    <AddResourceModal
      section={{ id: 'section-1' }}
      courseId="course-1"
      organisationId="org-1"
      userId="user-1"
      availableResources={[]}
      onChanged={vi.fn()}
      onClose={vi.fn()}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Create new resource/ }))
}

describe('AddResourceModal camera recording', () => {
  it('saves the edit made on a camera recording onto the uploaded video', async () => {
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Take video' }))
    fireEvent.click(screen.getByRole('button', { name: 'Finish camera recording' }))

    fireEvent.click(screen.getByRole('button', { name: 'Upload & add' }))

    await waitFor(() => expect(linkResourceToCourse).toHaveBeenCalled())
    expect(uploadVideoResource).toHaveBeenCalledWith('org-1', 'user-1', expect.any(File), 'Camera recording')
    expect(updateVideoEdit).toHaveBeenCalledWith('new-video', recordedEdit)
  })

  it('drops the edit when another file is chosen instead', async () => {
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Take video' }))
    fireEvent.click(screen.getByRole('button', { name: 'Finish camera recording' }))

    const browse = document.querySelector('input[type="file"][accept="video/*"]:not([capture])')
    fireEvent.change(browse, { target: { files: [new File(['other'], 'other.mp4', { type: 'video/mp4' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Upload & add' }))

    await waitFor(() => expect(linkResourceToCourse).toHaveBeenCalled())
    expect(updateVideoEdit).not.toHaveBeenCalled()
  })
})
