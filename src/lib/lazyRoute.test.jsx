import { Suspense } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ErrorBoundary from '../components/ErrorBoundary'
import { lazyRoute } from './lazyRoute'

function memoryStorage(initial = {}) {
  const values = { ...initial }
  return {
    getItem: (key) => values[key] ?? null,
    setItem: (key, value) => { values[key] = value },
    removeItem: (key) => { delete values[key] },
    values,
  }
}

function renderLazy(Page) {
  return render(
    <ErrorBoundary>
      <Suspense fallback={<p>loading</p>}>
        <Page />
      </Suspense>
    </ErrorBoundary>
  )
}

describe('lazyRoute', () => {
  it('renders the loaded page and clears any earlier reload marker', async () => {
    const storage = memoryStorage({ 'learnscope-chunk-reload': '1' })
    const Page = lazyRoute(async () => ({ default: () => <p>page ready</p> }), storage, vi.fn())
    renderLazy(Page)
    expect(await screen.findByText('page ready')).toBeInTheDocument()
    expect(storage.values['learnscope-chunk-reload']).toBeUndefined()
  })

  it('reloads once when a chunk from a previous deploy is missing', async () => {
    const storage = memoryStorage()
    const reload = vi.fn()
    const Page = lazyRoute(() => Promise.reject(new Error('Failed to fetch dynamically imported module')), storage, reload)
    renderLazy(Page)
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    expect(storage.values['learnscope-chunk-reload']).toBe('1')
  })

  it('surfaces the error instead of reloading again after a reload already happened', async () => {
    const storage = memoryStorage({ 'learnscope-chunk-reload': '1' })
    const reload = vi.fn()
    const Page = lazyRoute(() => Promise.reject(new Error('missing chunk')), storage, reload)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    renderLazy(Page)
    expect(await screen.findByText('Something went wrong.')).toBeInTheDocument()
    expect(reload).not.toHaveBeenCalled()
  })
})
