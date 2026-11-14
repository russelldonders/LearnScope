import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { english } from '../lib/i18n/translations'

vi.mock('../context/LanguageContext', async () => {
  const { english: en } = await import('../lib/i18n/translations')
  const t = (key) => key.split('.').reduce((v, part) => v?.[part], en) ?? key
  return { useLanguage: () => ({ language: 'en', setLanguage: vi.fn(), t }) }
})

const { default: SkillNetworkSection } = await import('./SkillNetworkSection')

afterEach(cleanup)

function renderSection(props = {}) {
  return render(
    <MemoryRouter>
      <SkillNetworkSection
        librarySkillId="lib-1"
        connections={[{ id: 'c1', name: 'Alex Kim', avatarUrl: null }]}
        totalTrackersCount={12}
        onInviteToRate={vi.fn()}
        onRecommend={vi.fn()}
        {...props}
      />
    </MemoryRouter>,
  )
}

describe('SkillNetworkSection', () => {
  it('lists connections on the skill by name, linking to their profile', () => {
    renderSection()
    expect(screen.getByRole('link', { name: /Alex Kim/ })).toHaveAttribute('href', '/skills-profile/c1')
  })

  it('shows how many people track the skill as information, not something to open', () => {
    renderSection()
    const count = screen.getByText(/12/)
    expect(count.closest('a, button')).toBeNull()
  })

  it('offers inviting others to rate, finding an expert, and recommending the skill', () => {
    const onInviteToRate = vi.fn()
    const onFindExpert = vi.fn()
    const onRecommend = vi.fn()
    renderSection({ onInviteToRate, onFindExpert, onRecommend })
    fireEvent.click(screen.getByRole('button', { name: english.skillDetail.inviteOthersToAssess }))
    fireEvent.click(screen.getByRole('button', { name: english.skillDetail.findAnExpert }))
    fireEvent.click(screen.getByRole('button', { name: english.skillDetail.recommendThisSkill }))
    expect(onInviteToRate).toHaveBeenCalledOnce()
    expect(onFindExpert).toHaveBeenCalledOnce()
    expect(onRecommend).toHaveBeenCalledOnce()
  })

  it('says so when no connections are on the skill, and hides invite for someone else’s skill', () => {
    renderSection({ connections: [], onInviteToRate: null })
    expect(screen.getByText(english.skillDetail.noConnectionsTrackSkill)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: english.skillDetail.inviteOthersToAssess })).not.toBeInTheDocument()
  })
})
