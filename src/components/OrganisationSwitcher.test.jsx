import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OrganisationSwitcher from './OrganisationSwitcher'

afterEach(cleanup)

const ORGS = [
  { id: 'org-1', name: 'BHFC' },
  { id: 'org-2', name: 'Leeds United', logo_url: '/leeds.png' },
  { id: 'org-3', name: 'Mc Donalds' },
]

function renderSwitcher(props = {}) {
  const onChange = vi.fn()
  render(<OrganisationSwitcher organisations={ORGS} selectedId="org-2" onChange={onChange} {...props} />)
  return { onChange, button: screen.getByRole('button', { name: /Organisation/ }) }
}

describe('OrganisationSwitcher', () => {
  it('shows only the current organisation until opened', () => {
    const { button } = renderSwitcher()
    expect(button).toHaveTextContent('Leeds United')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('lists every organisation with the current one selected', () => {
    const { button } = renderSwitcher()
    fireEvent.click(button)
    const listbox = screen.getByRole('listbox')
    expect(within(listbox).getAllByRole('option')).toHaveLength(3)
    expect(within(listbox).getByRole('option', { name: 'BHFC' })).toHaveAttribute('aria-selected', 'false')
    expect(within(listbox).getByRole('option', { name: 'Leeds United' })).toHaveAttribute('aria-selected', 'true')
  })

  it('switches organisation when another one is clicked', () => {
    const { button, onChange } = renderSwitcher()
    fireEvent.click(button)
    fireEvent.click(screen.getByRole('option', { name: 'Mc Donalds' }))
    expect(onChange).toHaveBeenCalledWith('org-3')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it("doesn't call onChange when the current organisation is chosen again", () => {
    const { button, onChange } = renderSwitcher()
    fireEvent.click(button)
    fireEvent.click(screen.getByRole('option', { name: 'Leeds United' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('supports keyboard selection and Escape', () => {
    const { button, onChange } = renderSwitcher()
    fireEvent.keyDown(button, { key: 'ArrowDown' })
    const listbox = screen.getByRole('listbox')
    fireEvent.keyDown(listbox, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(button).toHaveFocus()

    fireEvent.keyDown(button, { key: 'ArrowDown' })
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' })
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('org-3')
  })

  it('offers a filter when there are many organisations', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ id: `org-${i}`, name: `Organisation ${i}` }))
    const onChange = vi.fn()
    render(<OrganisationSwitcher organisations={many} selectedId="org-0" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Organisation/ }))
    const filter = screen.getByRole('combobox', { name: 'Filter organisations' })
    fireEvent.change(filter, { target: { value: '7' } })
    expect(screen.getAllByRole('option')).toHaveLength(1)
    fireEvent.keyDown(filter, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('org-7')
  })
})
