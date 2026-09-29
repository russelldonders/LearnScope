import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import NotificationDrawer from './NotificationDrawer'

afterEach(cleanup)

function renderDrawer(props = {}) {
  return render(
    <MemoryRouter>
      <NotificationDrawer
        items={[]}
        loading={false}
        error={null}
        viewAllHref="/actions?org=acme"
        onClose={vi.fn()}
        onRetry={vi.fn()}
        {...props}
      />
    </MemoryRouter>
  )
}

describe('NotificationDrawer', () => {
  it('shows notifications from all workspaces with source labels and a context-preserving link', () => {
    renderDrawer({
      items: [
        { id: 'course:1', title: 'Course Assigned', detail: 'Safe Handling', source: 'Acme', occurredAt: '2026-09-29T10:00:00Z' },
        { id: 'rating:1', title: 'New Rating', detail: 'Taylor rated Communication.', source: 'Personal', occurredAt: '2026-09-28T10:00:00Z' },
      ],
    })

    expect(screen.getByRole('dialog', { name: 'Notifications' })).toHaveAccessibleDescription('Across all your LearnScope workspaces')
    expect(screen.getByText('Acme')).toBeInTheDocument()
    expect(screen.getByText('Personal')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View All Actions' })).toHaveAttribute('href', '/actions?org=acme')
  })

  it('provides empty, loading, retry, and close states', () => {
    const onClose = vi.fn()
    const onRetry = vi.fn()
    const { rerender } = renderDrawer({ loading: true, onClose, onRetry })
    expect(screen.getByText('Loading notifications…')).toBeInTheDocument()

    rerender(
      <MemoryRouter>
        <NotificationDrawer items={[]} loading={false} error="Notifications could not be loaded." onClose={onClose} onRetry={onRetry} />
      </MemoryRouter>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }))
    expect(onRetry).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Close notifications' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
