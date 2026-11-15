import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AdminSkillCourseBuilderDialog from './AdminSkillCourseBuilderDialog'
import {
  createGeneratedSkillCourse,
  generateSkillCourseDraft,
  getSystemProviderOrganisationId,
} from '../lib/admin/skillCourseGeneration'

vi.mock('../lib/admin/skillCourseGeneration', async (importOriginal) => ({
  ...(await importOriginal()),
  createGeneratedSkillCourse: vi.fn(),
  generateSkillCourseDraft: vi.fn(),
  getSystemProviderOrganisationId: vi.fn(),
}))

const skill = {
  id: 'skill-1',
  name: 'Coaching',
  category: 'Leadership',
  description: 'Help people think and grow.',
  status: 'active',
  knowledge_level_guide: ['One', 'Two', 'Three', 'Four', 'Five'],
}

describe('AdminSkillCourseBuilderDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSystemProviderOrganisationId.mockResolvedValue('org-system')
    generateSkillCourseDraft.mockImplementation(async (brief) => ({
      name: brief.topic,
      synopsis: 'Generated course',
      courseType: 'Online',
      durationValue: 60,
      durationUnit: 'mins',
      sections: [{ title: 'Section', instructions: null, pages: [{ title: 'Page', pageContent: { version: 1, blocks: [] } }] }],
    }))
    let courseNumber = 0
    createGeneratedSkillCourse.mockImplementation(async () => `course-${++courseNumber}`)
  })
  afterEach(() => cleanup())

  it('builds all five knowledge-level courses with automatic Global publication', async () => {
    render(
      <MemoryRouter>
        <AdminSkillCourseBuilderDialog skills={[skill]} onClose={vi.fn()} onFinished={vi.fn()} />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Build 5 courses' }))

    expect(await screen.findByText('Course series ready')).toBeInTheDocument()
    await waitFor(() => expect(createGeneratedSkillCourse).toHaveBeenCalledTimes(5))
    expect(createGeneratedSkillCourse).toHaveBeenCalledWith(expect.objectContaining({
      skillId: 'skill-1',
      level: 1,
      publishGlobal: true,
    }))
    expect(screen.getAllByRole('link', { name: 'Open course' })).toHaveLength(5)
  })
})
