import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EmployerSettingsMenu from './EmployerSettingsMenu'

afterEach(cleanup)

function renderMenu(items) {
  render(<MemoryRouter><EmployerSettingsMenu items={items} /></MemoryRouter>)
  return screen.getByRole('button', { name: 'Settings' })
}

describe('EmployerSettingsMenu', () => {
  it('is a text Settings menu that lists its sub-items when opened', () => {
    const button = renderMenu([
      { key: 'organisation', label: 'Organisation details', description: 'Logo and links', onSelect: vi.fn() },
      { key: 'lms', label: 'LMS connections', to: '/organisation/organisations/org-1/lms-connections' },
    ])
    expect(button).toHaveAttribute('aria-haspopup', 'menu')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    fireEvent.click(button)
    expect(screen.getByRole('menuitem', { name: /Organisation details/ })).toHaveFocus()
    expect(screen.getByRole('menuitem', { name: /LMS connections/ }))
      .toHaveAttribute('href', '/organisation/organisations/org-1/lms-connections')
  })

  it('runs a dialog item and closes the menu', () => {
    const onSelect = vi.fn()
    fireEvent.click(renderMenu([{ key: 'member-fields', label: 'Member fields', onSelect }]))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Member fields' }))
    expect(onSelect).toHaveBeenCalled()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('moves between items with the arrow keys and closes on Escape', () => {
    const button = renderMenu([
      { key: 'a', label: 'First', onSelect: vi.fn() },
      { key: 'b', label: 'Second', onSelect: vi.fn() },
    ])
    fireEvent.keyDown(button, { key: 'ArrowDown' })
    const menu = screen.getByRole('menu')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: 'Second' })).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: 'First' })).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(button).toHaveFocus()
  })

  it('renders nothing when there is nothing to configure', () => {
    render(<MemoryRouter><EmployerSettingsMenu items={[]} /></MemoryRouter>)
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument()
  })
})
