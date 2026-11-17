import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RoleProfileSkillsPanel from './RoleProfileSkillsPanel'
import { FIXTURE_ROLE_PROFILES, FIXTURE_SKILL_CATALOGUE } from './roleProfileFixtures'

afterEach(cleanup)

const FIXTURE_REQUIRED_SKILLS = FIXTURE_ROLE_PROFILES[0].requiredSkills

const SUGGESTIONS = [
  { name: 'Incident response', reason: 'Handles outages.', targetLevel: 4, isExisting: true },
  { name: 'Queue management', reason: 'Keeps tickets moving.', targetLevel: 2, isExisting: false },
]

function renderPanel(props = {}) {
  const handlers = {
    onAddSkill: vi.fn().mockResolvedValue(true),
    onRequestSuggestions: vi.fn().mockResolvedValue(SUGGESTIONS),
    onUpdateTargetLevel: vi.fn(),
    onRemoveSkill: vi.fn(),
    ...props,
  }
  render(
    <RoleProfileSkillsPanel
      roleName="Support Lead"
      requiredSkills={FIXTURE_REQUIRED_SKILLS}
      availableSkills={FIXTURE_SKILL_CATALOGUE}
      {...props}
      {...handlers}
    />
  )
  return handlers
}

function search(text) {
  fireEvent.change(screen.getByLabelText('Find or create a skill'), { target: { value: text } })
}

describe('RoleProfileSkillsPanel', () => {
  it('lists each required skill with its target level', () => {
    renderPanel()
    expect(screen.getByText('Facilitation')).toBeInTheDocument()
    expect(screen.getByLabelText('Target level for Facilitation')).toHaveValue('3')
  })

  it('shows an empty state when there are no required skills', () => {
    renderPanel({ requiredSkills: [] })
    expect(screen.getByText('No required skills yet.')).toBeInTheDocument()
  })

  it('calls onUpdateTargetLevel when a target level select changes', () => {
    const { onUpdateTargetLevel } = renderPanel()
    fireEvent.change(screen.getByLabelText('Target level for Facilitation'), { target: { value: '5' } })
    expect(onUpdateTargetLevel).toHaveBeenCalledWith('skill-1', 5)
  })

  it('asks for confirmation before removing a skill', () => {
    const { onRemoveSkill } = renderPanel()
    const row = screen.getByText('Facilitation').closest('li')
    fireEvent.click(within(row).getByRole('button', { name: 'Remove' }))
    expect(onRemoveSkill).not.toHaveBeenCalled()
    fireEvent.click(within(row).getByRole('button', { name: 'Confirm removing Facilitation' }))
    expect(onRemoveSkill).toHaveBeenCalledWith('skill-1')
  })

  it('cancelling a removal keeps the skill', () => {
    const { onRemoveSkill } = renderPanel()
    const row = screen.getByText('Facilitation').closest('li')
    fireEvent.click(within(row).getByRole('button', { name: 'Remove' }))
    fireEvent.click(within(row).getByRole('button', { name: 'Cancel' }))
    expect(onRemoveSkill).not.toHaveBeenCalled()
  })

  it('renders an inline error', () => {
    renderPanel({ error: "Couldn't save that skill." })
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't save that skill.")
  })

  describe('finding and creating skills', () => {
    it('searches existing skills, excluding ones already required', () => {
      renderPanel()
      search('a')
      const results = screen.getByRole('list', { name: 'Matching skills' })
      expect(within(results).queryByText('Facilitation')).not.toBeInTheDocument()
      expect(within(results).getByText('Data storytelling')).toBeInTheDocument()
    })

    it('adds a found skill at the chosen level', async () => {
      const { onAddSkill } = renderPanel({ requiredSkills: [] })
      search('data')
      fireEvent.change(screen.getByLabelText('Level needed'), { target: { value: '2' } })
      fireEvent.click(screen.getByRole('button', { name: 'Add Data storytelling' }))
      expect(onAddSkill).toHaveBeenCalledWith({ skillId: 'skill-3', name: 'Data storytelling', targetLevel: 2 })
      await waitFor(() => expect(screen.getByLabelText('Find or create a skill')).toHaveValue(''))
    })

    it('offers to create a new skill when nothing matches exactly', () => {
      const { onAddSkill } = renderPanel()
      search('Root cause analysis')
      fireEvent.click(screen.getByRole('button', { name: 'Create and add' }))
      expect(onAddSkill).toHaveBeenCalledWith({ name: 'Root cause analysis', targetLevel: 3 })
    })

    it("doesn't offer to create a skill that already exists", () => {
      renderPanel()
      search('data storytelling')
      expect(screen.queryByRole('button', { name: 'Create and add' })).not.toBeInTheDocument()
      search('facilitation')
      expect(screen.getByText('“facilitation” is already required for this role.')).toBeInTheDocument()
    })

    it('marks the organisation’s own skills', () => {
      renderPanel({
        requiredSkills: [],
        availableSkills: [
          { id: 'lib-1', name: 'Public speaking' },
          { id: 'org-1', name: 'Public sector procurement', fromOrganisation: true },
        ],
      })
      search('public')
      const rows = within(screen.getByRole('list', { name: 'Matching skills' })).getAllByRole('listitem')
      expect(rows[0]).toHaveTextContent('Public sector procurement')
      expect(rows[0]).toHaveTextContent('Your organisation')
    })
  })

  describe('AI suggestions', () => {
    it('shows one suggestion at a time with its reason and suggested level', async () => {
      renderPanel({ requiredSkills: [] })
      fireEvent.click(screen.getByRole('button', { name: 'Suggest skills with AI' }))
      expect(await screen.findByText('Incident response')).toBeInTheDocument()
      expect(screen.getByText('Handles outages.')).toBeInTheDocument()
      expect(screen.getByText('In skill library')).toBeInTheDocument()
      expect(screen.getAllByLabelText('Level needed')[0]).toHaveValue('4')
      expect(screen.queryByText('Queue management')).not.toBeInTheDocument()
    })

    it('adds an existing suggestion by its id and moves to the next', async () => {
      const { onAddSkill } = renderPanel({ requiredSkills: [] })
      fireEvent.click(screen.getByRole('button', { name: 'Suggest skills with AI' }))
      await screen.findByText('Incident response')
      fireEvent.click(screen.getByRole('button', { name: 'Add to role' }))
      expect(onAddSkill).toHaveBeenCalledWith({ skillId: 'skill-4', name: 'Incident response', targetLevel: 4 })
      expect(await screen.findByText('Queue management')).toBeInTheDocument()
      expect(screen.getByText('New skill')).toBeInTheDocument()
    })

    it('adds a new suggestion by name so it can be created', async () => {
      const { onAddSkill } = renderPanel({ requiredSkills: [] })
      fireEvent.click(screen.getByRole('button', { name: 'Suggest skills with AI' }))
      await screen.findByText('Incident response')
      fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
      fireEvent.click(screen.getByRole('button', { name: 'Add to role' }))
      expect(onAddSkill).toHaveBeenCalledWith({ skillId: undefined, name: 'Queue management', targetLevel: 2 })
    })

    it('stays on a suggestion that failed to add', async () => {
      renderPanel({ requiredSkills: [], onAddSkill: vi.fn().mockResolvedValue(false) })
      fireEvent.click(screen.getByRole('button', { name: 'Suggest skills with AI' }))
      await screen.findByText('Incident response')
      fireEvent.click(screen.getByRole('button', { name: 'Add to role' }))
      await waitFor(() => expect(screen.getByText('Incident response')).toBeInTheDocument())
    })

    it('excludes required and already-shown skills when asking for more', async () => {
      const { onRequestSuggestions } = renderPanel({
        requiredSkills: [{ skillId: 'skill-1', name: 'Facilitation', targetLevel: 3 }],
      })
      fireEvent.click(screen.getByRole('button', { name: 'Suggest skills with AI' }))
      await screen.findByText('Incident response')
      fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
      fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
      fireEvent.click(screen.getByRole('button', { name: 'Suggest more with AI' }))
      await waitFor(() => expect(onRequestSuggestions).toHaveBeenCalledTimes(2))
      expect(onRequestSuggestions).toHaveBeenLastCalledWith(['Facilitation', 'Incident response', 'Queue management'])
    })

    it('skips a suggestion that is already required', async () => {
      renderPanel()
      fireEvent.click(screen.getByRole('button', { name: 'Suggest skills with AI' }))
      expect(await screen.findByText('Queue management')).toBeInTheDocument()
      expect(screen.queryByText('Handles outages.')).not.toBeInTheDocument()
    })

    it('shows an error when suggestions fail', async () => {
      renderPanel({ onRequestSuggestions: vi.fn().mockRejectedValue(new Error('AI limit reached.')) })
      fireEvent.click(screen.getByRole('button', { name: 'Suggest skills with AI' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('AI limit reached.')
    })

    it('needs a role name before suggesting', () => {
      renderPanel({ roleName: '' })
      expect(screen.getByRole('button', { name: 'Suggest skills with AI' })).toBeDisabled()
    })
  })
})
