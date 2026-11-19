// How the learner and a connection relate, as short phrases for the People
// page: management at an employer first (the more formal tie), then the teams
// they share, grouped by who leads. Each phrase is { key, params } under
// connections.relation.* -- teams are listed by name, whatever their number.

const LINE_TYPES = ['primary', 'functional', 'project', 'delegate']

// lines: list_my_line_management_with_connections rows for one connection.
// teams: list_my_shared_teams_by_connection rows for one connection, mapped
// by listMySharedTeamsByConnection.
export function describeRelationships({ lines = [], teams = [] }) {
  const phrases = []

  const seenLines = new Set()
  for (const line of lines) {
    const type = LINE_TYPES.includes(line.relationshipType) ? line.relationshipType : 'primary'
    const key = `${line.direction === 'manages_me' ? 'managesMe' : 'managesThem'}.${type}`
    const id = `${key}|${line.employerName}`
    if (seenLines.has(id)) continue
    seenLines.add(id)
    phrases.push({ key, params: { organisation: line.employerName } })
  }

  const groups = { leadsThem: [], leadsMe: [], coLead: [], teammates: [], invited: [] }
  for (const team of teams) {
    if (team.membershipStatus === 'pending') groups.invited.push(team)
    else if (team.myRole === 'manager' && team.theirRole === 'manager') groups.coLead.push(team)
    else if (team.myRole === 'manager') groups.leadsThem.push(team)
    else if (team.theirRole === 'manager') groups.leadsMe.push(team)
    else groups.teammates.push(team)
  }
  for (const [key, list] of Object.entries(groups)) {
    if (list.length === 0) continue
    phrases.push({ key: `team.${key}`, params: { teams: list.map((team) => team.teamName).join(', ') } })
  }

  return phrases
}
