import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RoleProfileSkillSuggestions from './RoleProfileSkillSuggestions'

afterEach(cleanup)

const SUGGESTIONS = [
  { name: 'Incident response', reason: 'Handles outages.', targetLevel: 4, isExisting: true },
  { name: 'Queue management', reason: 'Keeps tickets moving.', targetLevel: 2, isExisting: false },
]

function renderSuggestions(props = {}) {
  const onRequestSuggestions = props.onRequestSuggestions ?? vi.fn().mockResolvedValue(SUGGESTIONS)
  const onAcceptSuggestion = props.onAcceptSuggestion ?? vi.fn().mockResolvedValue(true)
  render(
    <RoleProfileSkillSuggestions
      roleName="Support Lead"
      requiredSkillNames={[]}
      {...props}
      onRequestSuggestions={onRequestSuggestions}
      onAcceptSuggestion={onAcceptSuggestion}
    />
  )
  return { onRequestSuggestions, onAcceptSuggestion }
}

describe('RoleProfileSkillSuggestions', () => {
  it('shows one suggestion at a time with its reason and suggested level', async () => {
    renderSuggestions()
    fireEvent.click(screen.getByRole('button', { name: 'Suggest a skill' }))
    expect(await screen.findByText('Incident response')).toBeInTheDocument()
    expect(screen.getByText('Handles outages.')).toBeInTheDocument()
    expect(screen.getByText('In skill library')).toBeInTheDocument()
    expect(screen.getByLabelText('Target level')).toHaveValue('4')
    expect(screen.queryByText('Queue management')).not.toBeInTheDocument()
    expect(screen.getByText('1 more suggestion after this one.')).toBeInTheDocument()
  })

  it('moves to the next suggestion when one is skipped', async () => {
    const { onAcceptSuggestion } = renderSuggestions()
    fireEvent.click(screen.getByRole('button', { name: 'Suggest a skill' }))
    await screen.findByText('Incident response')
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(screen.getByText('Queue management')).toBeInTheDocument()
    expect(screen.getByText('New skill')).toBeInTheDocument()
    expect(onAcceptSuggestion).not.toHaveBeenCalled()
  })

  it('adds the suggestion at the chosen level and moves on', async () => {
    const { onAcceptSuggestion } = renderSuggestions()
    fireEvent.click(screen.getByRole('button', { name: 'Suggest a skill' }))
    await screen.findByText('Incident response')
    fireEvent.change(screen.getByLabelText('Target level'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to role' }))
    expect(onAcceptSuggestion).toHaveBeenCalledWith({ ...SUGGESTIONS[0], targetLevel: 5 })
    expect(await screen.findByText('Queue management')).toBeInTheDocument()
  })

  it('stays on a suggestion that failed to add', async () => {
    renderSuggestions({ onAcceptSuggestion: vi.fn().mockResolvedValue(false) })
    fireEvent.click(screen.getByRole('button', { name: 'Suggest a skill' }))
    await screen.findByText('Incident response')
    fireEvent.click(screen.getByRole('button', { name: 'Add to role' }))
    await waitFor(() => expect(screen.getByText('Incident response')).toBeInTheDocument())
  })

  it('excludes required and already-shown skills when asking for more', async () => {
    const { onRequestSuggestions } = renderSuggestions({ requiredSkillNames: ['Facilitation'] })
    fireEvent.click(screen.getByRole('button', { name: 'Suggest a skill' }))
    await screen.findByText('Incident response')
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    fireEvent.click(screen.getByRole('button', { name: 'Suggest more skills' }))
    await waitFor(() => expect(onRequestSuggestions).toHaveBeenCalledTimes(2))
    expect(onRequestSuggestions).toHaveBeenLastCalledWith(['Facilitation', 'Incident response', 'Queue management'])
  })

  it('shows an error when suggestions fail', async () => {
    renderSuggestions({ onRequestSuggestions: vi.fn().mockRejectedValue(new Error('AI limit reached.')) })
    fireEvent.click(screen.getByRole('button', { name: 'Suggest a skill' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('AI limit reached.')
  })

  it('needs a role name before suggesting', () => {
    renderSuggestions({ roleName: '' })
    expect(screen.getByRole('button', { name: 'Suggest a skill' })).toBeDisabled()
  })
})
