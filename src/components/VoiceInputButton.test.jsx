import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../context/LanguageContext', () => import('../test/languageMock'))

const { default: VoiceInputButton } = await import('./VoiceInputButton')

// A stand-in for the browser's speech recognition.
let instances = []
class FakeRecognition {
  constructor() {
    this.start = vi.fn()
    this.stop = vi.fn(() => this.onend?.())
    this.abort = vi.fn(() => this.onend?.())
    instances.push(this)
  }
}

beforeEach(() => {
  instances = []
  window.SpeechRecognition = FakeRecognition
})
afterEach(() => {
  cleanup()
  delete window.SpeechRecognition
})

describe('VoiceInputButton', () => {
  it('stops listening as soon as the form is sent, ignoring anything heard after', () => {
    const onText = vi.fn()
    const { rerender } = render(<VoiceInputButton text="" onText={onText} onError={vi.fn()} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true')
    const recognition = instances[0]

    // "Log it" was pressed: the form disables the button while it reads.
    rerender(<VoiceInputButton text="" onText={onText} onError={vi.fn()} disabled />)
    expect(recognition.abort).toHaveBeenCalled()
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false')
    // Nothing still being heard can refill the box that was just cleared.
    expect(recognition.onresult).toBeNull()
    expect(onText).not.toHaveBeenCalled()
  })

  it('leaves the microphone alone when the button is disabled without listening', () => {
    const { rerender } = render(<VoiceInputButton text="" onText={vi.fn()} onError={vi.fn()} />)
    rerender(<VoiceInputButton text="" onText={vi.fn()} onError={vi.fn()} disabled />)
    expect(instances).toHaveLength(0)
  })
})
