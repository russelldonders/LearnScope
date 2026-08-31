import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ScreenRecorderModal from './ScreenRecorderModal'

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

  pause() {
    this.state = 'paused'
  }

  resume() {
    this.state = 'recording'
  }

  stop() {
    this.state = 'inactive'
    this.dispatchEvent(new MessageEvent('dataavailable', { data: new Blob(['video'], { type: this.mimeType }) }))
    this.dispatchEvent(new Event('stop'))
  }
}

function fakeTrack() {
  return Object.assign(new EventTarget(), { stop: vi.fn() })
}

function fakeStream({ video = [], audio = [] } = {}) {
  return {
    getTracks: () => [...video, ...audio],
    getVideoTracks: () => video,
    getAudioTracks: () => audio,
  }
}

describe('ScreenRecorderModal', () => {
  beforeEach(() => {
    globalThis.MediaRecorder = FakeMediaRecorder
    globalThis.MediaStream = class {
      constructor(tracks) {
        this.tracks = tracks
      }
      getTracks() { return this.tracks }
      getVideoTracks() { return this.tracks.filter((track) => track.kind !== 'audio') }
      getAudioTracks() { return this.tracks.filter((track) => track.kind === 'audio') }
    }
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:recording')
    globalThis.URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('explains the permission step before recording', () => {
    render(<ScreenRecorderModal onClose={vi.fn()} onRecorded={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Record your screen' })).toBeInTheDocument()
    expect(screen.getByText('Your browser will ask what to share')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /include microphone narration/i })).toBeChecked()
  })

  it('shows a recoverable error when screen capture is unavailable', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {} })
    render(<ScreenRecorderModal onClose={vi.fn()} onRecorded={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Choose screen and record' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Screen recording is not supported')
  })

  it('records, previews, and returns a video file', async () => {
    const videoTrack = Object.assign(fakeTrack(), { kind: 'video' })
    const displayStream = fakeStream({ video: [videoTrack] })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getDisplayMedia: vi.fn().mockResolvedValue(displayStream),
        getUserMedia: vi.fn(),
      },
    })
    const onRecorded = vi.fn()
    const onClose = vi.fn()
    render(<ScreenRecorderModal onClose={onClose} onRecorded={onRecorded} />)

    fireEvent.click(screen.getByRole('checkbox', { name: /include microphone narration/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose screen and record' }))
    expect(await screen.findByText('Recording in progress')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Stop recording'))
    expect(await screen.findByText('Recording ready')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Use recording' }))

    await waitFor(() => expect(onRecorded).toHaveBeenCalledOnce())
    expect(onRecorded.mock.calls[0][0]).toBeInstanceOf(File)
    expect(onRecorded.mock.calls[0][0].type).toContain('video/webm')
    expect(onClose).toHaveBeenCalledOnce()
  })
})
