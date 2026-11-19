import { describe, expect, it } from 'vitest'
import { describeRelationships } from './connectionRelationships'

const team = (teamName, myRole, theirRole, membershipStatus = 'active') => ({ teamId: teamName, teamName, myRole, theirRole, membershipStatus })

describe('describeRelationships', () => {
  it('says who manages whom at an employer, either way round', () => {
    expect(describeRelationships({
      lines: [
        { direction: 'manages_me', relationshipType: 'primary', employerName: 'Acme' },
        { direction: 'manages_them', relationshipType: 'project', employerName: 'Beta' },
      ],
    })).toEqual([
      { key: 'managesMe.primary', params: { organisation: 'Acme' } },
      { key: 'managesThem.project', params: { organisation: 'Beta' } },
    ])
  })

  it('groups shared teams by who leads them, naming every team', () => {
    expect(describeRelationships({
      teams: [
        team('Coaching', 'manager', 'member'),
        team('Mentoring', 'manager', 'member'),
        team('Design', 'member', 'manager'),
        team('Ops', 'manager', 'manager'),
        team('Book club', 'member', 'member'),
        team('Sales', 'manager', 'member', 'pending'),
      ],
    })).toEqual([
      { key: 'team.leadsThem', params: { teams: 'Coaching, Mentoring' } },
      { key: 'team.leadsMe', params: { teams: 'Design' } },
      { key: 'team.coLead', params: { teams: 'Ops' } },
      { key: 'team.teammates', params: { teams: 'Book club' } },
      { key: 'team.invited', params: { teams: 'Sales' } },
    ])
  })

  it('puts management first and says nothing when there is no tie', () => {
    const phrases = describeRelationships({
      lines: [{ direction: 'manages_me', relationshipType: 'primary', employerName: 'Acme' }],
      teams: [team('Design', 'member', 'manager')],
    })
    expect(phrases.map((p) => p.key)).toEqual(['managesMe.primary', 'team.leadsMe'])
    expect(describeRelationships({})).toEqual([])
  })
})
