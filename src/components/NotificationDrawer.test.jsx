import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import NotificationDrawer from './NotificationDrawer'

function item(index) {
  return {
    id: `notification-${index}`,
    title: `Notification ${index}`,
    detail: `Detail ${index}`,
    source: 'Personal',
    actions: [{ label: `Act ${index}`, href: `/actions/${index}` }],
  }
}

function renderDrawer(props = {}) {
  return render(
    <MemoryRouter>
      <NotificationDrawer
        items={[item(1)]}
        loading={false}
        error={null}
        onClose={vi.fn()}
        onRetry={vi.fn()}
        onDismiss={vi.fn().mockResolvedValue(undefined)}
        {...props}
      />
    </MemoryRouter>
  )
}

describe('NotificationDrawer', () => {
  it('places the action and dismiss controls directly on each notification', async () => {
    const onDismiss = vi.fn().mockResolvedValue(undefined)
    renderDrawer({ onDismiss })

    expect(screen.getByRole('link', { name: 'Act 1' })).toHaveAttribute('href', '/actions/1')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(onDismiss).toHaveBeenCalledWith('notification-1'))
    expect(screen.queryByRole('link', { name: /View All Actions/i })).not.toBeInTheDocument()
  })

  it('only offers to reveal the full list when more than eight actions exist', () => {
    renderDrawer({ items: Array.from({ length: 9 }, (_, index) => item(index + 1)) })

    expect(screen.queryByText('Notification 9')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'View all 9 actions' }))
    expect(screen.getByText('Notification 9')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /View all/ })).not.toBeInTheDocument()
  })
})
