import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const from = vi.fn()
vi.mock('./supabaseClient', () => ({ supabase: { rpc, from } }))

const {
  assignEmployerRoleProfile,
  buildLearnerRoleAlignment,
  decideEmployerRoleAssignment,
  disconnectEmployerRoleAssignment,
  mapRoleProfile,
} = await import('./employerRoleProfiles')

describe('employer role profile service', () => {
  beforeEach(() => vi.clearAllMocks())

  it('maps employer requirements without treating them as learner-owned data', () => {
    expect(mapRoleProfile({
      id: 'role-1', employer_id: 'employer-1', name: 'Designer', status: 'active',
      employer_role_profile_skills: [{
        library_skill_id: 'library-1', target_level: 4, requirement: 'required',
        skill_library: { name: 'Research', category: 'Design' },
      }],
      employer_role_profile_training: [{
        catalogue_course_id: 'course-1', requirement: 'recommended',
        course_catalogue: { name: 'Research foundations', provider: 'Academy' },
      }],
    })).toMatchObject({
      id: 'role-1', employerId: 'employer-1', name: 'Designer',
      skillRequirements: [{ skillId: 'library-1', name: 'Research', targetLevel: 4 }],
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
})
