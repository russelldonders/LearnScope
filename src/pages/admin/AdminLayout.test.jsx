import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AdminLayout from './AdminLayout'

vi.mock('../../components/AppHeader', () => ({ default: () => null }))

afterEach(cleanup)

function renderAt(url) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <AdminLayout><p>Page</p></AdminLayout>
    </MemoryRouter>
  )
  return screen.getByRole('navigation', { name: 'Platform console' })
}

describe('AdminLayout navigation', () => {
  it('shows a few grouped menus instead of a long row of tabs', () => {
    const nav = renderAt('/admin')
    expect(within(nav).getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
    for (const group of ['People', 'Content', 'Moderation', 'Insights']) {
      expect(within(nav).getByRole('button', { name: group })).toHaveAttribute('aria-haspopup', 'menu')
    }
    expect(within(nav).getByRole('link', { name: 'Settings' })).toBeInTheDocument()
  })

  it('opens a group to its pages', () => {
    const nav = renderAt('/admin')
    fireEvent.click(within(nav).getByRole('button', { name: 'Moderation' }))
    expect(screen.getByRole('menuitem', { name: 'Course approvals' }))
      .toHaveAttribute('href', '/admin/courses?status=pending_approval')
    expect(screen.getByRole('menuitem', { name: 'Reported resources' }))
      .toHaveAttribute('href', '/admin/reported-resources')
  })

  it('keeps the group highlighted on a detail page and marks the current page', () => {
    const nav = renderAt('/admin/organisations/org-1')
    const people = within(nav).getByRole('button', { name: 'People' })
    expect(people.className).toContain('border-moss')
    expect(within(nav).getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current')
    fireEvent.click(people)
    expect(screen.getByRole('menuitem', { name: 'Organisations' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('menuitem', { name: 'Users' })).not.toHaveAttribute('aria-current')
  })
})
