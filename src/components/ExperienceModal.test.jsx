import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ExperienceModal from './ExperienceModal'

describe('ExperienceModal subject timing', () => {
  afterEach(cleanup)

  it('saves a subject with a study duration and no dates', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<ExperienceModal type="subject" onSave={onSave} onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Subject name'), { target: { value: 'Applied Mathematics' } })
    fireEvent.change(screen.getByLabelText('Duration of study'), { target: { value: 'One semester' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      type: 'subject',
      title: 'Applied Mathematics',
      start_date: null,
      end_date: null,
      study_duration: 'One semester',
    }))
  })

  it('requires either a start date or a study duration for a subject', async () => {
    const onSave = vi.fn()
    render(<ExperienceModal type="subject" onSave={onSave} onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Subject name'), { target: { value: 'Physics' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a start date or a duration of study.')
    expect(onSave).not.toHaveBeenCalled()
  })
})
