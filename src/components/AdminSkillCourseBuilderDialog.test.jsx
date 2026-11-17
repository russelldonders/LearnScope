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

  it('keeps the course format numbers as typed, without a leading zero, and builds with them', async () => {
    render(
      <MemoryRouter>
        <AdminSkillCourseBuilderDialog skills={[skill]} onClose={vi.fn()} onFinished={vi.fn()} />
      </MemoryRouter>,
    )
    const duration = screen.getByRole('spinbutton', { name: 'Duration' })
    const sections = screen.getByRole('spinbutton', { name: 'Sections' })
    const pages = screen.getByRole('spinbutton', { name: 'Learning pages each' })

    // Clearing a field leaves it empty rather than putting a 0 in it.
    fireEvent.change(duration, { target: { value: '' } })
    expect(duration).toHaveValue(null)
    fireEvent.change(duration, { target: { value: '15' } })
    expect(duration).toHaveValue(15)
    expect(duration.value).toBe('15')

    // A leading zero, or a number out of range, is tidied when the field is left.
    fireEvent.change(sections, { target: { value: '05' } })
    fireEvent.blur(sections)
    expect(sections.value).toBe('5')
    fireEvent.change(pages, { target: { value: '40' } })
    fireEvent.blur(pages)
    expect(pages.value).toBe('6')

    // Building straight from a field still being typed in uses a whole number.
    fireEvent.change(duration, { target: { value: '015' } })
    fireEvent.click(screen.getByRole('button', { name: 'Build 5 courses' }))
    await waitFor(() => expect(generateSkillCourseDraft).toHaveBeenCalled())
    const brief = generateSkillCourseDraft.mock.calls[0][0]
    expect(brief).toEqual(expect.objectContaining({ durationValue: '15', sectionCount: '5', pagesPerSection: '6' }))
  })

  it('shows why a course failed and retries just that one', async () => {
    let failedOnce = false
    const ok = generateSkillCourseDraft.getMockImplementation()
    generateSkillCourseDraft.mockImplementation(async (brief, organisationId, options) => {
      if (options.level === 2 && !failedOnce) {
        failedOnce = true
        throw new Error('The AI wrote 4 sections instead of 5. The course wasn’t saved. Try again.')
      }
      return ok(brief, organisationId, options)
    })
    render(
      <MemoryRouter>
        <AdminSkillCourseBuilderDialog skills={[skill]} onClose={vi.fn()} onFinished={vi.fn()} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Build 5 courses' }))

    expect(await screen.findByText('The AI wrote 4 sections instead of 5. The course wasn’t saved. Try again.')).toBeInTheDocument()
    await waitFor(() => expect(saveGeneratedSkillCourseJob).toHaveBeenCalledTimes(4))
    generateSkillCourseDraft.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Retry Coaching level 2' }))

    await waitFor(() => expect(saveGeneratedSkillCourseJob).toHaveBeenCalledTimes(5))
    expect(generateSkillCourseDraft).toHaveBeenCalledTimes(1)
    expect(generateSkillCourseDraft.mock.calls[0][2].level).toBe(2)
    expect(await screen.findByText('Course series ready')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Retry Coaching/ })).not.toBeInTheDocument()
  })

  it('builds with only the chosen interactive and visual elements, and how much of them', async () => {
    render(
      <MemoryRouter>
        <AdminSkillCourseBuilderDialog skills={[skill]} onClose={vi.fn()} onFinished={vi.fn()} />
      </MemoryRouter>,
    )
    // All chosen to start with, in balance.
    expect(screen.getByRole('checkbox', { name: /Knowledge check/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Balanced/ })).toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(screen.getByText(/None chosen: courses will use text, callouts and quotes only/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: /Flip cards/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Animated explainer/ }))
    fireEvent.click(screen.getByRole('radio', { name: /Light/ }))

    fireEvent.click(screen.getByRole('button', { name: 'Build 5 courses' }))
    await waitFor(() => expect(generateSkillCourseDraft).toHaveBeenCalled())
    expect(generateSkillCourseDraft.mock.calls[0][0]).toEqual(expect.objectContaining({ elements: ['flip_cards', 'animation'], elementAmount: 'light' }))
  })

  it('defines a separate final test with scoring and question settings', async () => {
    render(<MemoryRouter><AdminSkillCourseBuilderDialog skills={[skill]} onClose={vi.fn()} onFinished={vi.fn()} /></MemoryRouter>)
    expect(screen.queryByRole('checkbox', { name: /Scored question/ })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Questions' }), { target: { value: '6' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Pass mark' }), { target: { value: '80' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Points per question' }), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Matching' }))
    fireEvent.click(screen.getByRole('button', { name: 'Build 5 courses' }))
    await waitFor(() => expect(generateSkillCourseDraft).toHaveBeenCalled())
    expect(generateSkillCourseDraft.mock.calls[0][0]).toEqual(expect.objectContaining({
      assessmentEnabled: true,
      assessmentQuestionCount: '6',
      assessmentPassMark: '80',
      assessmentPointsPerQuestion: '2',
      assessmentQuestionTypes: expect.not.arrayContaining(['matching']),
    }))
  })

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
