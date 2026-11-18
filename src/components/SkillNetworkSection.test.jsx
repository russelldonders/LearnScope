import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { english } from '../lib/i18n/translations'

vi.mock('../context/LanguageContext', async () => {
  const { english: en } = await import('../lib/i18n/translations')
  const t = (key, params) => {
    const value = key.split('.').reduce((v, part) => v?.[part], en) ?? key
    return typeof value === 'string' && params ? value.replace(/\{(\w+)\}/g, (m, name) => (name in params ? params[name] : m)) : value
  }
  return { useLanguage: () => ({ language: 'en', setLanguage: vi.fn(), t }) }
})

const { default: SkillNetworkSection, RatingsFromOthers } = await import('./SkillNetworkSection')

const n = english.skillDetail.network

afterEach(cleanup)

function renderSection(props = {}) {
  return render(
    <MemoryRouter>
      <SkillNetworkSection
        librarySkillId="lib-1"
        isOwner
        recommendInvites={[
          { id: 'm1', status: 'pending', invitee_email: 'sam@example.com', created_at: '2026-11-11T10:00:00Z' },
          { id: 'm2', status: 'accepted', invitee_email: 'ann@example.com', accepted_by: 'u9', accepted_at: '2026-11-12T10:00:00Z' },
        ]}
        recommendAcceptors={{ u9: { name: 'Ann Accepted', avatarUrl: null } }}
        knownPeople={{ 'pat@example.com': { name: 'Pat Known', avatarUrl: null } }}
        connections={[{ id: 'c1', name: 'Alex Kim', avatarUrl: null }]}
        totalTrackersCount={12}
        onFindExpert={vi.fn()}
        onRecommend={vi.fn()}
        {...props}
      />
    </MemoryRouter>,
  )
}

const part = (title) => screen.getByRole('region', { name: title })

describe('SkillNetworkSection', () => {
  it('shows your connections with the skill in their own card at the top', () => {
    renderSection()
    // The first region is the section itself (headed "Skill network" for
    // screen readers); its cards follow in order.
    const [, firstCard] = screen.getAllByRole('region')
    expect(firstCard).toHaveAccessibleName(n.yourNetworkTitle)
    expect(within(firstCard).getByRole('link', { name: /Alex Kim/ })).toHaveAttribute('href', '/skills-profile/c1')
  })

  it('says when none of your connections have the skill', () => {
    renderSection({ connections: [] })
    expect(within(part(n.yourNetworkTitle)).getByText(english.skillDetail.noConnectionsTrackSkill)).toBeInTheDocument()
  })

  it('shows recommendations sent and taken up', () => {
    const onRecommend = vi.fn()
    renderSection({ onRecommend })
    const recommend = part(n.recommendTitle)
    expect(within(recommend).queryByText('Alex Kim')).not.toBeInTheDocument()
    expect(within(recommend).getByText('Ann Accepted')).toBeInTheDocument()
    // Not a connection yet, so there's no name to show -- the address stands in.
    expect(within(recommend).getByText('sam@example.com')).toBeInTheDocument()
    fireEvent.click(within(recommend).getByRole('button', { name: 'Recommend this skill to someone new' }))
    expect(onRecommend).toHaveBeenCalledOnce()
  })

  it('gives the wider count as information only, with Find an expert', () => {
    const onFindExpert = vi.fn()
    renderSection({ onFindExpert })
    const wider = part(n.widerTitle)
    expect(within(wider).getByText(/12/).closest('a, button')).toBeNull()
    fireEvent.click(within(wider).getByRole('button', { name: english.skillDetail.findAnExpert }))
    expect(onFindExpert).toHaveBeenCalledOnce()
  })

  it('shows someone else’s skill without the owner’s recommendations', () => {
    renderSection({ isOwner: false })
    expect(screen.queryByText('sam@example.com')).not.toBeInTheDocument()
    expect(screen.getByText('Alex Kim')).toBeInTheDocument()
  })
})

describe('RatingsFromOthers (in the Validate box)', () => {
  it('lists who rated and who is still to, by name where known, leaving out share links', () => {
    render(
      <RatingsFromOthers
        ratings={[{ id: 'r1', rater_id: 'p1', rater_name: 'Rita Rater', level: 4, rated_at: '2026-11-01T10:00:00Z' }]}
        rateInvites={[
          { id: 'i1', status: 'pending', invitee_email: 'pat@example.com', created_at: '2026-11-10T10:00:00Z' },
          { id: 'i2', status: 'pending', invitee_email: null, created_at: '2026-11-10T10:00:00Z' },
        ]}
        knownPeople={{ 'pat@example.com': { name: 'Pat Known', avatarUrl: null } }}
      />,
    )
    expect(screen.getByText('Rita Rater')).toBeInTheDocument()
    expect(screen.getByText('Pat Known')).toBeInTheDocument()
    expect(screen.queryByText('pat@example.com')).not.toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('says so when no one has been asked yet', () => {
    render(<RatingsFromOthers />)
    expect(screen.getByText(n.noRatingsYet)).toBeInTheDocument()
  })
})

describe('your connections with the skill', () => {
  const connection = (id, name, level) => ({ id, name, avatarUrl: null, level })
  const SIX = [
    connection('c3', 'Ben Beginner', 1),
    connection('c2', 'Sam Skilled', 4),
    connection('c5', 'Cal Capable', 3),
    connection('c1', 'Eva Expert', 5),
    connection('c6', 'Dee Developing', 2),
    connection('c4', 'Una Unknown', null),
  ]
  const yourNetwork = () => screen.getByRole('heading', { name: n.yourNetworkTitle }).closest('section')
  const shownNames = () => within(yourNetwork()).getAllByRole('link').map((link) => SIX.find((c) => link.textContent.includes(c.name))?.name)

  it('shows each connection\'s level, the most skilled first', () => {
    renderSection({ connections: SIX.slice(0, 5) })
    expect(shownNames()).toEqual(['Eva Expert', 'Sam Skilled', 'Cal Capable', 'Dee Developing', 'Ben Beginner'])
    expect(within(yourNetwork()).getByRole('link', { name: /Eva Expert/ })).toHaveTextContent('Expert')
    expect(within(yourNetwork()).getByRole('link', { name: /Sam Skilled/ })).toHaveTextContent('Skilled')
    // Five fit at a glance: no filter yet.
    expect(within(yourNetwork()).queryByLabelText('Skill level')).not.toBeInTheDocument()
  })

  it('offers a level filter once more than five connections have the skill', () => {
    renderSection({ connections: SIX })
    const filter = within(yourNetwork()).getByLabelText('Skill level')
    expect(shownNames()).toEqual(['Eva Expert', 'Sam Skilled', 'Cal Capable', 'Dee Developing', 'Ben Beginner', 'Una Unknown'])
    fireEvent.change(filter, { target: { value: '4' } })
    expect(shownNames()).toEqual(['Eva Expert', 'Sam Skilled'])
    fireEvent.change(filter, { target: { value: '5' } })
    expect(shownNames()).toEqual(['Eva Expert'])
  })

  it('says so when no connection is at the chosen level', () => {
    renderSection({ connections: SIX.map((c) => ({ ...c, level: c.level && Math.min(c.level, 3) })) })
    fireEvent.change(within(yourNetwork()).getByLabelText('Skill level'), { target: { value: '5' } })
    expect(within(yourNetwork()).getByText(english.modals.peopleWithSkill.noMatches)).toBeInTheDocument()
  })
})
