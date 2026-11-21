// Read-aloud with the device's own voices (the Web Speech API). Browsers
// differ a lot: left to itself, speechSynthesis uses the system default,
// which on many laptops is an old robotic voice even when a far more natural
// one is installed. So this picks the most natural voice for the language,
// and lets the person choose another (remembered on this device only).

const STORAGE_KEY = 'learnscope-read-aloud-voice'

// The app's interface languages to the speech tag used when speaking and
// listening.
const SPEECH_TAGS = { en: 'en-GB', de: 'de-DE', es: 'es-ES', fr: 'fr-FR', it: 'it-IT', nl: 'nl-NL', zh: 'zh-CN' }

export function speechTag(language) {
  return SPEECH_TAGS[language] ?? SPEECH_TAGS.en
}

// Higher is more natural: Edge's online "Natural" voices, Google's, Apple's
// enhanced and premium voices, and other neural voices sound far closer to a
// person than the older system voices (eSpeak, "Microsoft David" and so on).
export function voiceQuality(voice) {
  const name = voice.name ?? ''
  if (/natural|neural/i.test(name)) return 5
  if (/premium|enhanced|siri/i.test(name)) return 4
  if (/google/i.test(name)) return 3
  if (!voice.localService) return 2
  if (/espeak|compact|david|zira|mark/i.test(name)) return 0
  return 1
}

function matchesLanguage(voice, language) {
  return (voice.lang ?? '').toLowerCase().startsWith(language.toLowerCase())
}

// The voices worth offering for a language, most natural first.
export function voicesFor(voices, language) {
  const tag = speechTag(language)
  return voices
    .filter((voice) => matchesLanguage(voice, language))
    .sort((a, b) => voiceQuality(b) - voiceQuality(a)
      || Number(matchesLanguage(b, tag)) - Number(matchesLanguage(a, tag))
      || a.name.localeCompare(b.name))
}

// The person's own choice if it's still available, else the most natural.
export function pickVoice(voices, language, preferredName = null) {
  const candidates = voicesFor(voices, language)
  return candidates.find((voice) => voice.name === preferredName) ?? candidates[0] ?? null
}

export function readPreferredVoice() {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function savePreferredVoice(name) {
  try {
    if (name) window.localStorage.setItem(STORAGE_KEY, name)
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Not remembered: the most natural voice is used next time.
  }
}

// Voices load asynchronously in Chrome and Edge; calls back with the list
// now and whenever it changes. Returns a function that stops listening.
export function watchVoices(onVoices) {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null
  if (!synth) return () => {}
  const update = () => onVoices(synth.getVoices())
  update()
  synth.addEventListener?.('voiceschanged', update)
  return () => synth.removeEventListener?.('voiceschanged', update)
}

export function speak(text, { voice = null, language = 'en' } = {}) {
  const synth = window.speechSynthesis
  synth.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = voice?.lang ?? speechTag(language)
  if (voice) utterance.voice = voice
  // A touch slower than the default reads as calmer and clearer.
  utterance.rate = 0.97
  synth.speak(utterance)
}
