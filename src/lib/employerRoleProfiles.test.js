import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const from = vi.fn()
vi.mock('./supabaseClient', () => ({ supabase: { rpc, from } }))

const {
  assignEmployerRoleProfile,
  buildLearnerRoleAlignment,
  decideEmployerRoleAssignment,
  disconnectEmployerRoleAssignment,
  listEmployerRoleAssignments,
  mapRoleProfile,
  replaceEmployerRoleSkillRequirements,
  replaceEmployerRoleTrainingRequirements,
} = await import('./employerRoleProfiles')

describe('employer role profile service', () => {
  beforeEach(() => vi.clearAllMocks())

  it('maps employer requirements without treating them as learner-owned data', () => {
    expect(mapRoleProfile({
      id: 'role-1', employer_id: 'employer-1', name: 'Designer', status: 'active',
      employer_role_profile_skills: [{
        library_skill_id: 'library-1', target_level: 4, requirement: 'required',
        skill_library: {
          name: 'Research', category: 'Design',
          skill_composite_definitions: [{ status: 'published', skill_composite_components: [{ id: 'one' }, { id: 'two' }] }],
        },
      }],
      employer_role_profile_training: [{
        catalogue_course_id: 'course-1', requirement: 'recommended',
        course_catalogue: { name: 'Research foundations', provider: 'Academy' },
      }],
    })).toMatchObject({
      id: 'role-1', employerId: 'employer-1', name: 'Designer',
      skillRequirements: [{ skillId: 'library-1', name: 'Research', targetLevel: 4, isComposite: true, componentCount: 2 }],
      trainingRequirements: [{ courseId: 'course-1', name: 'Research foundations' }],
    })
  })

  it('proposes links using an employer member id rather than editing a learner role', async () => {
    rpc.mockResolvedValue({ data: 'assignment-1', error: null })
    await assignEmployerRoleProfile('role-1', 'member-1')
    expect(rpc).toHaveBeenCalledWith('assign_employer_role_profile', {
      p_role_profile_id: 'role-1', p_employer_member_id: 'member-1',
    })
  })

  it('requires the learner-selected experience only when accepting', async () => {
    rpc.mockResolvedValue({ error: null })
    await decideEmployerRoleAssignment('assignment-1', true, 'experience-1')
    expect(rpc).toHaveBeenCalledWith('decide_employer_role_assignment', {
      p_assignment_id: 'assignment-1', p_accept: true, p_learner_experience_id: 'experience-1',
    })
  })

  it('disconnects without deleting the learner experience', async () => {
    rpc.mockResolvedValue({ error: null })
    await disconnectEmployerRoleAssignment('assignment-1')
    expect(rpc).toHaveBeenCalledWith('disconnect_employer_role_assignment', {
      p_assignment_id: 'assignment-1',
    })
  })

  it('replaces skill requirements through one atomic RPC', async () => {
    rpc.mockResolvedValue({ error: null })
    await replaceEmployerRoleSkillRequirements('role-1', [{
      skillId: 'library-1', targetLevel: 4, requirement: 'required',
    }])
    expect(rpc).toHaveBeenCalledWith('replace_employer_role_profile_skills', {
      p_role_profile_id: 'role-1',
      p_requirements: [{ skillId: 'library-1', targetLevel: 4, requirement: 'required' }],
    })
  })

  it('can atomically clear all training requirements', async () => {
    rpc.mockResolvedValue({ error: null })
    await replaceEmployerRoleTrainingRequirements('role-1', [])
    expect(rpc).toHaveBeenCalledWith('replace_employer_role_profile_training', {
      p_role_profile_id: 'role-1', p_requirements: [],
    })
  })

  it('maps only the narrow employer assignment projection', async () => {
    rpc.mockResolvedValue({ data: [{
      id: 'assignment-1', employer_member_id: 'member-1', learner_user_id: 'user-1',
      learner_name: 'Taylor', status: 'linked', proposed_at: '2026-09-01',
      decided_at: '2026-09-02', learner_experience_id: 'experience-1',
      current_role_title: 'Designer', current_role_organization: 'Acme',
    }], error: null })
    await expect(listEmployerRoleAssignments('role-1')).resolves.toEqual([{
      id: 'assignment-1', memberId: 'member-1', userId: 'user-1', name: 'Taylor',
      status: 'linked', proposedAt: '2026-09-01', linkedAt: '2026-09-02',
      currentRole: { id: 'experience-1', title: 'Designer', organization: 'Acme' },
    }])
    expect(rpc).toHaveBeenCalledWith('list_employer_role_assignments', {
      p_role_profile_id: 'role-1',
    })
  })

  it('calculates alignment from learner-owned data without changing the role profile', () => {
    const roleProfile = {
      skillRequirements: [{ skillId: 'library-1', name: 'Research', targetLevel: 4 }],
      trainingRequirements: [{ courseId: 'course-1', name: 'Research foundations' }],
    }
    expect(buildLearnerRoleAlignment(
      roleProfile,
      [{ id: 'skill-1', librarySkillId: 'library-1', level: 2 }],
      [{ catalogueCourseId: 'course-1', completedDate: '2026-08-01' }]
    )).toEqual({
      skills: [{
        skillId: 'library-1', name: 'Research', targetLevel: 4,
        personalSkillId: 'skill-1', currentLevel: 2, gap: 2,
      }],
      training: [{ courseId: 'course-1', name: 'Research foundations', completed: true }],
    })
    expect(roleProfile.skillRequirements[0]).not.toHaveProperty('currentLevel')
  })

  it('adds composite coverage to learner alignment without using it as an assessed level', () => {
    const roleProfile = {
      skillRequirements: [{ skillId: 'library-1', name: 'Research', targetLevel: 4, isComposite: true }],
      trainingRequirements: [],
    }
    const coverage = { percentage: 75, requiredMet: 2, requiredTotal: 3, allRequiredMet: false }

    const result = buildLearnerRoleAlignment(roleProfile, [], [], {
      'library-1': { coverage },
    })

    expect(result.skills[0]).toMatchObject({ currentLevel: null, gap: 4, componentCoverage: coverage })
  })
})
