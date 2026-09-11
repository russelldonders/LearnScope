import { Component } from 'react'

// No error-reporting service (Sentry etc.) exists in this app, and nothing
// else catches render-time exceptions -- without this, any uncaught throw
// anywhere in the tree unmounts React entirely and leaves a blank page with
// no visible error, which is what made the employer-invite crash so hard to
// pin down.
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
            <p className="text-ink font-medium mb-2">Something went wrong.</p>
            <p className="text-secondary text-sm mb-4">
              Try reloading the page. If this keeps happening, please let us know.
            </p>
            {import.meta.env.DEV && (
              <pre className="text-left text-xs text-red-700 bg-paper border border-hairline rounded p-2 mb-4 overflow-auto max-h-48">
                {String(this.state.error?.stack || this.state.error)}
              </pre>
            )}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md bg-moss text-paper py-2 px-4 font-medium hover:opacity-90"
            >
              Reload
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
