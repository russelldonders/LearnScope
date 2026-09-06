import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import EmployerDataAccessConsentDialog from './EmployerDataAccessConsentDialog'
afterEach(cleanup)
const request = { employers: { name: 'Acme' }, requested_data: ['skills', 'training', 'experience'], requested_skill_library_ids: ['sql'], requested_skill_names: ['SQL'], request_comment: 'For your development plan' }
const skills = [{ id: 'a', library_skill_id: 'sql', name: 'SQL' }, { id: 'b', library_skill_id: 'writing', name: 'Writing' }]
it('requires explicit choices and only offers the requested personal skills', async () => {
  const onConfirm = vi.fn().mockResolvedValue()
  render(<EmployerDataAccessConsentDialog request={request} skills={skills} onConfirm={onConfirm} onClose={() => {}} />)
  expect(screen.getByText('For your development plan')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Approve selected data' })).toBeDisabled()
  fireEvent.click(screen.getByLabelText('Selected skills and their assessments'))
  expect(screen.queryByLabelText('Writing')).toBeNull()
  fireEvent.click(screen.getByLabelText('SQL'))
  fireEvent.click(screen.getByRole('button', { name: 'Approve selected data' }))
  await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(['a'], ['skills']))
})
it('allows consent to training alone without sharing requested skills or experience', async () => {
  const onConfirm = vi.fn().mockResolvedValue()
  render(<EmployerDataAccessConsentDialog request={request} skills={skills} onConfirm={onConfirm} onClose={() => {}} />)
  fireEvent.click(screen.getByLabelText(/Training records/))
  fireEvent.click(screen.getByRole('button', { name: 'Approve selected data' }))
  await waitFor(() => expect(onConfirm).toHaveBeenCalledWith([], ['training']))
})
it('all-skills requests offer existing skills without automatically selecting them', () => {
  render(<EmployerDataAccessConsentDialog request={{ ...request, requested_skill_library_ids: [], requested_skill_names: [] }} skills={skills} onConfirm={() => {}} onClose={() => {}} />)
  fireEvent.click(screen.getByLabelText('Selected skills and their assessments'))
  expect(screen.getByLabelText('Writing')).not.toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'Select all existing skills' }))
  expect(screen.getByLabelText('SQL')).toBeChecked()
  expect(screen.getByLabelText('Writing')).toBeChecked()
})
