import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AdminSkillCourseBuilderDialog from './AdminSkillCourseBuilderDialog'
import {
  abortSkillCourseGeneration,
  generateSkillCourseDraft,
  getSystemProviderOrganisationId,
  saveGeneratedSkillCourseJob,
} from '../lib/admin/skillCourseGeneration'

vi.mock('../lib/admin/skillCourseGeneration', async (importOriginal) => ({
  ...(await importOriginal()),
  abortSkillCourseGeneration: vi.fn(),
  saveGeneratedSkillCourseJob: vi.fn(),
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
    abortSkillCourseGeneration.mockResolvedValue({ jobs: [] })
    let generatedJob = 0
    generateSkillCourseDraft.mockImplementation(async (brief) => ({ jobId: `job-${++generatedJob}`, draft: {
      name: brief.topic,
      synopsis: 'Generated course',
      courseType: 'Online',
      durationValue: 60,
      durationUnit: 'mins',
      sections: [{ title: 'Section', instructions: null, pages: [{ title: 'Page', pageContent: { version: 1, blocks: [] } }] }],
    } }))
    let courseNumber = 0
    saveGeneratedSkillCourseJob.mockImplementation(async () => `course-${++courseNumber}`)
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
    await waitFor(() => expect(saveGeneratedSkillCourseJob).toHaveBeenCalledTimes(5))
    // Saved from each finished job, not from a draft sent back by the browser.
    expect(saveGeneratedSkillCourseJob).toHaveBeenCalledWith({ jobId: 'job-1', publishGlobal: true })
    expect(screen.getAllByRole('link', { name: 'Open course' })).toHaveLength(5)
  })

  it('aborts active jobs and does not create their courses', async () => {
    const rejectors = []
    let jobNumber = 0
    generateSkillCourseDraft.mockImplementation(async (_brief, _organisationId, options) => {
      options.onJobCreated(`job-${++jobNumber}`)
      return new Promise((_resolve, reject) => rejectors.push(reject))
    })
    abortSkillCourseGeneration.mockImplementation(async () => {
      for (const reject of rejectors) reject(Object.assign(new Error('Course build aborted.'), { code: 'COURSE_BUILD_ABORTED' }))
      return { jobs: [] }
    })

    render(
      <MemoryRouter>
        <AdminSkillCourseBuilderDialog skills={[skill]} onClose={vi.fn()} onFinished={vi.fn()} />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Build 5 courses' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Abort build' }))

    expect(await screen.findByText('Course build stopped')).toBeInTheDocument()
    expect(abortSkillCourseGeneration).toHaveBeenCalledWith(['job-1', 'job-2'])
    expect(saveGeneratedSkillCourseJob).not.toHaveBeenCalled()
    expect(screen.getAllByText('Aborted')).toHaveLength(5)
  })
})
