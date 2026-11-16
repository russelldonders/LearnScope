import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ExperienceModal from './ExperienceModal'
import { LanguageProvider } from '../context/LanguageContext'

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}))
vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }) }),
    rpc: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
  },
}))

function renderModal(props) {
  return render(
    <LanguageProvider>
      <ExperienceModal {...props} />
    </LanguageProvider>
  )
}

describe('ExperienceModal subject timing', () => {
  afterEach(cleanup)

  it('saves a subject with a study duration and no dates', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    renderModal({ type: 'subject', onSave, onClose: vi.fn() })

    expect(screen.queryByLabelText(/Institution/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Organization website/)).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Subject name'), { target: { value: 'Applied Mathematics' } })
    fireEvent.change(screen.getByLabelText('Duration of study'), { target: { value: '6' } })
    fireEvent.change(screen.getByLabelText('Duration unit'), { target: { value: 'months' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      type: 'subject',
      title: 'Applied Mathematics',
      start_date: null,
      end_date: null,
      study_duration: null,
      study_duration_value: 6,
      study_duration_unit: 'months',
    }))
  })

  it('requires either a start date or a study duration for a subject', async () => {
    const onSave = vi.fn()
    renderModal({ type: 'subject', onSave, onClose: vi.fn() })

    fireEvent.change(screen.getByLabelText('Subject name'), { target: { value: 'Physics' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a start date or a duration of study.')
    expect(onSave).not.toHaveBeenCalled()
  })
})

describe('ExperienceModal dates', () => {
  afterEach(cleanup)

  function fillJob() {
    fireEvent.change(screen.getByLabelText('Role title'), { target: { value: 'Analyst' } })
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'Acme' } })
  }

  it('refuses an end date before the start date', async () => {
    const onSave = vi.fn()
    renderModal({ type: 'employment', onSave, onClose: vi.fn() })
    fillJob()
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2015-06-01' } })
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2015-01-31' } })

    expect(screen.getByLabelText('End date')).toHaveAttribute('min', '2015-06-01')
    // Submit the form directly so the component's own check runs even where
    // the browser's date-range validation would have stopped it first.
    fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form'))

    expect(await screen.findByText("End date can't be before the start date.")).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('saves a backdated job with the dates the learner entered', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    renderModal({ type: 'employment', onSave, onClose: vi.fn() })
    fillJob()
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2015-06-01' } })
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2016-03-31' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form'))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ start_date: '2015-06-01', end_date: '2016-03-31' }))
  })
})
