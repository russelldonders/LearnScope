import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CameraRecorderModal from './CameraRecorderModal'

vi.mock('../lib/courseContent', () => ({
  contentFileUrl: () => '/training.mp4',
  updateVideoEdit: vi.fn(),
}))

class FakeMediaRecorder extends EventTarget {
  static isTypeSupported = vi.fn(() => true)

  constructor(stream, options) {
    super()
    this.stream = stream
    this.mimeType = options?.mimeType || 'video/webm'
    this.state = 'inactive'
  }

  start() {
    this.state = 'recording'
  }

  stop() {
    this.state = 'inactive'
    this.dispatchEvent(new MessageEvent('dataavailable', { data: new Blob(['video'], { type: this.mimeType }) }))
    this.dispatchEvent(new Event('stop'))
  }
}

function fakeStream() {
  const tracks = [{ kind: 'video', stop: vi.fn() }, { kind: 'audio', stop: vi.fn() }]
  return { getTracks: () => tracks, tracks }
}

function useCamera(getUserMedia = vi.fn(async () => fakeStream())) {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
  return getUserMedia
}

async function cameraReady() {
  const shutter = await screen.findByRole('button', { name: /Record video/ })
  await waitFor(() => expect(shutter).toBeEnabled())
  return shutter
}

describe('CameraRecorderModal', () => {
  beforeEach(() => {
    globalThis.MediaRecorder = FakeMediaRecorder
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:recording')
    globalThis.URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('opens the front camera with sound', async () => {
    const getUserMedia = useCamera()
    render(<CameraRecorderModal onClose={vi.fn()} onRecorded={vi.fn()} />)
    await cameraReady()
    expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: true, video: expect.objectContaining({ facingMode: 'user' }) }))
  })

  it('tap starts recording and the next tap stops it, then opens the editor', async () => {
    useCamera()
    const onRecorded = vi.fn()
    const onClose = vi.fn()
    render(<CameraRecorderModal onClose={onClose} onRecorded={onRecorded} />)
    const shutter = await cameraReady()

    fireEvent.pointerDown(shutter, { button: 0 })
    fireEvent.pointerUp(shutter, { button: 0 })
    expect(screen.getByText('Tap to stop')).toBeInTheDocument()

    expect(shutter).toHaveAccessibleName('Stop recording')
    fireEvent.pointerDown(shutter, { button: 0 })
    expect(await screen.findByRole('heading', { name: 'Edit Video' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Use video' }))
    expect(onRecorded).toHaveBeenCalledOnce()
    expect(onRecorded.mock.calls[0][0].name).toMatch(/^camera-recording-.*\.webm$/)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('records only while the shutter is held', async () => {
    useCamera()
    render(<CameraRecorderModal onClose={vi.fn()} onRecorded={vi.fn()} />)
    const shutter = await cameraReady()
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000)

    fireEvent.pointerDown(shutter, { button: 0 })
    now.mockReturnValue(2000)
    fireEvent.pointerUp(shutter, { button: 0 })

    expect(await screen.findByRole('heading', { name: 'Edit Video' })).toBeInTheDocument()
  })

  it('counts down before recording when a countdown is set', async () => {
    useCamera()
    render(<CameraRecorderModal onClose={vi.fn()} onRecorded={vi.fn()} />)
    await cameraReady()
    vi.useFakeTimers()

    fireEvent.click(screen.getByRole('button', { name: 'Countdown: off' }))
    const shutter = screen.getByRole('button', { name: 'Start recording in 3 seconds' })
    fireEvent.pointerDown(shutter, { button: 0 })
    expect(screen.getByText('3')).toBeInTheDocument()

    act(() => { vi.advanceTimersByTime(3000) })
    expect(screen.getByText('Tap to stop')).toBeInTheDocument()
  })

  it('flips to the back camera between takes', async () => {
    const getUserMedia = useCamera()
    render(<CameraRecorderModal onClose={vi.fn()} onRecorded={vi.fn()} />)
    await cameraReady()

    fireEvent.click(screen.getByRole('button', { name: 'Switch to back camera' }))
    await waitFor(() => expect(getUserMedia).toHaveBeenLastCalledWith(expect.objectContaining({ video: expect.objectContaining({ facingMode: 'environment' }) })))
  })

  it('explains when the camera is not allowed', async () => {
    useCamera(vi.fn(async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }) }))
    render(<CameraRecorderModal onClose={vi.fn()} onRecorded={vi.fn()} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Camera access was not allowed')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})
