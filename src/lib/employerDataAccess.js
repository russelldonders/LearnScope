export function requestedDataSummary(request) {
  return (request.requested_data || ['skills']).map((category) => category === 'skills'
    ? request.requested_skill_names?.length ? `Skills: ${request.requested_skill_names.join(', ')}` : 'All skills'
    : category === 'training' ? 'Training' : 'Experience').join('; ')
}

export function requestedPersonalSkills(request, skills) {
  if (!(request.requested_data || ['skills']).includes('skills')) return []
  const ids = request.requested_skill_library_ids || []
  return ids.length ? skills.filter((skill) => ids.includes(skill.library_skill_id)) : skills
}
