import { describe, expect, it } from 'vitest'
import { pickVoice, speechTag, voiceQuality, voicesFor } from './speech'

const voice = (name, lang, localService = true) => ({ name, lang, localService })

const VOICES = [
  voice('Microsoft David - English (United States)', 'en-US'),
  voice('Google UK English Female', 'en-GB', false),
  voice('Microsoft Sonia Online (Natural) - English (United Kingdom)', 'en-GB', false),
  voice('eSpeak English', 'en'),
  voice('Google Deutsch', 'de-DE', false),
]

describe('read-aloud voices', () => {
  it('ranks natural voices above the old system ones', () => {
    expect(voiceQuality(VOICES[2])).toBeGreaterThan(voiceQuality(VOICES[1]))
    expect(voiceQuality(VOICES[1])).toBeGreaterThan(voiceQuality(VOICES[0]))
    expect(voiceQuality(VOICES[3])).toBe(0)
  })

  it('offers only voices in the language, most natural first', () => {
    expect(voicesFor(VOICES, 'en').map((v) => v.name)).toEqual([
      'Microsoft Sonia Online (Natural) - English (United Kingdom)',
      'Google UK English Female',
      'eSpeak English',
      'Microsoft David - English (United States)',
    ])
    expect(voicesFor(VOICES, 'de').map((v) => v.name)).toEqual(['Google Deutsch'])
  })

  it('uses the person’s chosen voice while it’s available, else the most natural', () => {
    expect(pickVoice(VOICES, 'en', 'Google UK English Female').name).toBe('Google UK English Female')
    expect(pickVoice(VOICES, 'en', 'A voice that went away').name).toContain('Natural')
    expect(pickVoice(VOICES, 'fr')).toBeNull()
  })

  it('speaks and listens in the app’s language', () => {
    expect(speechTag('de')).toBe('de-DE')
    expect(speechTag('xx')).toBe('en-GB')
  })
})
