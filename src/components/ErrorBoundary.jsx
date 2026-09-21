import { Component } from 'react'
import { translations, INTERFACE_LANGUAGES } from '../lib/i18n/translations'

// No error-reporting service (Sentry etc.) exists in this app, and nothing
// else catches render-time exceptions -- without this, any uncaught throw
// anywhere in the tree unmounts React entirely and leaves a blank page with
// no visible error, which is what made the employer-invite crash so hard to
// pin down.
//
// This sits outside LanguageProvider in App.jsx on purpose (a crash inside
// the provider tree itself must still show a fallback), so it can't call
// useLanguage() -- it reads localStorage directly instead, duplicating just
// enough of LanguageContext's own resolution logic to stay self-contained.
const LANGUAGE_VALUES = INTERFACE_LANGUAGES.map((l) => l.value)
function fallbackT(key) {
  const stored = localStorage.getItem('learnscope-language')
  const language = LANGUAGE_VALUES.includes(stored) ? stored : 'en'
  return key.split('.').reduce((v, part) => v?.[part], translations[language]) ?? key
}

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Unhandled error in app tree:', error, info?.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-paper px-4">
          <div className="w-full max-w-md bg-card border border-hairline rounded-lg p-6 text-center">
            <p className="text-ink font-medium mb-2">{fallbackT('common.somethingWentWrong')}</p>
            <p className="text-secondary text-sm mb-4">
              {fallbackT('common.tryReloadingPage')}
            </p>
            {/* The message alone (no stack) is shown in every build, not just
                dev -- it's not sensitive, and it's often the only way to read
                a crash on a mobile device with no attached devtools. */}
            <pre className="text-left text-xs text-red-700 bg-paper border border-hairline rounded p-2 mb-4 overflow-auto max-h-48 whitespace-pre-wrap">
              {import.meta.env.DEV
                ? String(this.state.error?.stack || this.state.error)
                : String(this.state.error?.message || this.state.error)}
            </pre>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md bg-moss text-paper py-2 px-4 font-medium hover:opacity-90"
            >
              {fallbackT('common.reload')}
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
