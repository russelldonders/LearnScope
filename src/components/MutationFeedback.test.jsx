import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import MutationFeedback from './MutationFeedback'

describe('MutationFeedback', () => {
  it('renders nothing when there is no message', () => {
    const { container } = render(<MutationFeedback status="error" message={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for an idle status even with a message', () => {
    const { container } = render(<MutationFeedback status="idle" message="Something" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('announces an error assertively via role="alert"', () => {
    render(<MutationFeedback status="error" message="Couldn't save this." />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent("Couldn't save this.")
  })

  it('announces success politely via role="status"', () => {
    const { unmount } = render(<MutationFeedback status="success" message="Saved." />)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Saved.')
    unmount()
  })

  it('announces pending politely via role="status"', () => {
    const { unmount } = render(<MutationFeedback status="pending" message="Saving…" />)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Saving…')
    unmount()
  })
})
