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

const { default: SkillNetworkSection } = await import('./SkillNetworkSection')

const n = english.skillDetail.network

afterEach(cleanup)

function renderSection(props = {}) {
  return render(
    <MemoryRouter>
      <SkillNetworkSection
        skillName="Golf"
        librarySkillId="lib-1"
        isOwner
        ratings={[{ id: 'r1', rater_id: 'p1', rater_name: 'Rita Rater', level: 4, rated_at: '2026-11-01T10:00:00Z' }]}
        raterAvatars={{}}
        rateInvites={[
          { id: 'i1', status: 'pending', invitee_email: 'pat@example.com', created_at: '2026-11-10T10:00:00Z' },
          { id: 'i2', status: 'pending', invitee_email: null, created_at: '2026-11-10T10:00:00Z' },
        ]}
        recommendInvites={[
          { id: 'm1', status: 'pending', invitee_email: 'sam@example.com', created_at: '2026-11-11T10:00:00Z' },
          { id: 'm2', status: 'accepted', invitee_email: 'ann@example.com', accepted_by: 'u9', accepted_at: '2026-11-12T10:00:00Z' },
        ]}
        recommendAcceptors={{ u9: { name: 'Ann Accepted', avatarUrl: null } }}
        connections={[{ id: 'c1', name: 'Alex Kim', avatarUrl: null }]}
        totalTrackersCount={12}
        onInviteToRate={vi.fn()}
        onFindExpert={vi.fn()}
        onRecommend={vi.fn()}
        {...props}
      />
    </MemoryRouter>,
  )
}

const part = (title) => screen.getByRole('region', { name: title })

describe('SkillNetworkSection', () => {
  it('asks for ratings by skill name, listing who rated and who is still to (not share links)', () => {
    const onInviteToRate = vi.fn()
    renderSection({ onInviteToRate })
    const ratings = part(n.ratingsTitle)
    expect(within(ratings).getByText('Rita Rater')).toBeInTheDocument()
    expect(within(ratings).getByText('pat@example.com')).toBeInTheDocument()
    expect(within(ratings).getAllByRole('listitem')).toHaveLength(2)
    fireEvent.click(within(ratings).getByRole('button', { name: 'Ask someone to rate your Golf ability' }))
    expect(onInviteToRate).toHaveBeenCalledOnce()
  })

  it('shows connections with the skill and recommendations sent and taken up', () => {
    const onRecommend = vi.fn()
    renderSection({ onRecommend })
    const recommend = part(n.recommendTitle)
    expect(within(recommend).getByRole('link', { name: /Alex Kim/ })).toHaveAttribute('href', '/skills-profile/c1')
    expect(within(recommend).getByText('Ann Accepted')).toBeInTheDocument()
    expect(within(recommend).getByText('sam@example.com')).toBeInTheDocument()
    fireEvent.click(within(recommend).getByRole('button', { name: english.skillDetail.recommendThisSkill }))
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

  it('shows someone else’s skill without the owner’s ratings or invites', () => {
    renderSection({ isOwner: false })
    expect(screen.queryByRole('region', { name: n.ratingsTitle })).not.toBeInTheDocument()
    expect(screen.queryByText('sam@example.com')).not.toBeInTheDocument()
    expect(screen.getByText('Alex Kim')).toBeInTheDocument()
  })
})
