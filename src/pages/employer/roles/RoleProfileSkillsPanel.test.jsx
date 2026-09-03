import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RoleProfileSkillsPanel from './RoleProfileSkillsPanel'
import { FIXTURE_ROLE_PROFILES, FIXTURE_SKILL_CATALOGUE } from './roleProfileFixtures'

afterEach(cleanup)

const FIXTURE_REQUIRED_SKILLS = FIXTURE_ROLE_PROFILES[0].requiredSkills

describe('RoleProfileSkillsPanel', () => {
  it('lists each required skill with its target level', () => {
    render(<RoleProfileSkillsPanel requiredSkills={FIXTURE_REQUIRED_SKILLS} availableSkills={FIXTURE_SKILL_CATALOGUE} />)
    expect(screen.getByText('Facilitation')).toBeInTheDocument()
    expect(screen.getByLabelText('Target level for Facilitation')).toHaveValue('3')
  })

  it('shows an empty state when there are no required skills', () => {
    render(<RoleProfileSkillsPanel requiredSkills={[]} availableSkills={FIXTURE_SKILL_CATALOGUE} />)
    expect(screen.getByText('No required skills yet.')).toBeInTheDocument()
  })

  it('only offers skills not already required in the "add" picker', () => {
    render(<RoleProfileSkillsPanel requiredSkills={FIXTURE_REQUIRED_SKILLS} availableSkills={FIXTURE_SKILL_CATALOGUE} />)
    const picker = screen.getByLabelText('Add a skill')
    const optionNames = [...picker.querySelectorAll('option')].map((o) => o.textContent)
    expect(optionNames).not.toContain('Facilitation')
    expect(optionNames).toContain('Data storytelling')
  })

  it('calls onAddSkill with the chosen skill and target level', () => {
    const onAddSkill = vi.fn()
    render(<RoleProfileSkillsPanel requiredSkills={[]} availableSkills={FIXTURE_SKILL_CATALOGUE} onAddSkill={onAddSkill} />)
    fireEvent.change(screen.getByLabelText('Add a skill'), { target: { value: 'skill-3' } })
    fireEvent.change(screen.getByLabelText('Target level'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(onAddSkill).toHaveBeenCalledWith({ skillId: 'skill-3', targetLevel: 2 })
  })

  it('calls onUpdateTargetLevel when a target level select changes', () => {
    const onUpdateTargetLevel = vi.fn()
    render(
      <RoleProfileSkillsPanel
        requiredSkills={FIXTURE_REQUIRED_SKILLS}
        availableSkills={FIXTURE_SKILL_CATALOGUE}
        onUpdateTargetLevel={onUpdateTargetLevel}
      />
    )
    fireEvent.change(screen.getByLabelText('Target level for Facilitation'), { target: { value: '5' } })
    expect(onUpdateTargetLevel).toHaveBeenCalledWith('skill-1', 5)
  })

  it('calls onRemoveSkill for the right skill', () => {
    const onRemoveSkill = vi.fn()
    render(
      <RoleProfileSkillsPanel
        requiredSkills={FIXTURE_REQUIRED_SKILLS}
        availableSkills={FIXTURE_SKILL_CATALOGUE}
        onRemoveSkill={onRemoveSkill}
      />
    )
    const facilitationRow = screen.getByText('Facilitation').closest('li')
    fireEvent.click(within(facilitationRow).getByRole('button', { name: 'Remove' }))
    expect(onRemoveSkill).toHaveBeenCalledWith('skill-1')
  })

  it('renders an inline error', () => {
    render(
      <RoleProfileSkillsPanel
        requiredSkills={[]}
        availableSkills={FIXTURE_SKILL_CATALOGUE}
        error="Couldn't save that skill."
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't save that skill.")
  })
})
