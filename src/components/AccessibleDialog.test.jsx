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

  describe('the first field when it opens', () => {
    function withPointer(coarse, run) {
      const original = window.matchMedia
      window.matchMedia = (query) => ({ matches: coarse && query === '(pointer: coarse)', media: query })
      try {
        run()
      } finally {
        window.matchMedia = original
      }
    }
    const form = (
      <AccessibleDialog label="Invite someone" onClose={vi.fn()}>
        <label>Email<input type="email" /></label>
        <button type="button">Send</button>
      </AccessibleDialog>
    )

    it('is focused with a mouse or keyboard', () => {
      withPointer(false, () => {
        const { unmount } = render(form)
        expect(screen.getByLabelText('Email')).toHaveFocus()
        unmount()
      })
    })

    it('is left alone on a touch screen, so the keyboard does not cover the form', () => {
      withPointer(true, () => {
        const { unmount } = render(form)
        expect(screen.getByRole('dialog', { name: 'Invite someone' })).toHaveFocus()
        unmount()
      })
    })

    it('still takes focus on a touch screen when it is a button', () => {
      withPointer(true, () => {
        const { unmount } = render(
          <AccessibleDialog label="Confirm" onClose={vi.fn()}>
            <button type="button">OK</button>
          </AccessibleDialog>
        )
        expect(screen.getByRole('button', { name: 'OK' })).toHaveFocus()
        unmount()
      })
    })
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
