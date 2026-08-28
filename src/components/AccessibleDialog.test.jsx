import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import AccessibleDialog from './AccessibleDialog'

describe('AccessibleDialog', () => {
  it('exposes dialog semantics, contains focus, closes with Escape, and restores focus', () => {
    const onClose = vi.fn()
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()

    const { unmount } = render(
      <AccessibleDialog label="Example dialog" onClose={onClose} panelClassName="panel">
        <button type="button">First</button>
        <button type="button">Last</button>
      </AccessibleDialog>
    )

    const dialog = screen.getByRole('dialog', { name: 'Example dialog' })
    const first = screen.getByRole('button', { name: 'First' })
    const last = screen.getByRole('button', { name: 'Last' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(first).toHaveFocus()

    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(first).toHaveFocus()

    first.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()

    unmount()
    expect(opener).toHaveFocus()
    opener.remove()
  })

  it('only closes from the backdrop when backdrop closing is enabled', () => {
    const onClose = vi.fn()
    const { container } = render(
      <AccessibleDialog label="Example dialog" onClose={onClose} panelClassName="panel">
        <button type="button">Inside</button>
      </AccessibleDialog>
    )

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Inside' }))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.mouseDown(container.firstChild)
    expect(onClose).toHaveBeenCalledOnce()
  })
})
