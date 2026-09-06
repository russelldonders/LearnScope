import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import RequestDataAccessDialog from './RequestDataAccessDialog'
import { listLibrarySkills } from '../../lib/skillLibrary'
vi.mock('../../lib/skillLibrary', () => ({ listLibrarySkills: vi.fn() }))
beforeEach(() => { listLibrarySkills.mockResolvedValue([{ id: 'sql', name: 'SQL' }, { id: 'writing', name: 'Writing' }]) })
afterEach(cleanup)
it('sends selected categories, specific catalogue skills and a comment', async () => {
  const onSubmit = vi.fn().mockResolvedValue()
  render(<RequestDataAccessDialog count={2} onSubmit={onSubmit} onClose={() => {}} />)
  fireEvent.click(screen.getByLabelText('Training'))
  fireEvent.click(screen.getByLabelText('Experience'))
  fireEvent.click(screen.getByLabelText('Specific skills'))
  expect(screen.getByRole('button', { name: 'Send request' })).toBeDisabled()
  fireEvent.click(await screen.findByLabelText('SQL'))
  fireEvent.change(screen.getByLabelText('Comment for the user (optional)'), { target: { value: '  For your development plan  ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ categories: ['skills', 'training', 'experience'], skillIds: ['sql'], comment: 'For your development plan' }))
})
it('can request training without skills and blocks an empty scope', async () => {
  const onSubmit = vi.fn().mockResolvedValue()
  render(<RequestDataAccessDialog count={1} onSubmit={onSubmit} onClose={() => {}} />)
  fireEvent.click(screen.getByLabelText('Skills'))
  expect(screen.getByRole('button', { name: 'Send request' })).toBeDisabled()
  fireEvent.click(screen.getByLabelText('Training'))
  fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ categories: ['training'], skillIds: [], comment: '' }))
})
it('all skills clears specific IDs from the request payload', async () => {
  const onSubmit = vi.fn().mockResolvedValue()
  render(<RequestDataAccessDialog count={1} onSubmit={onSubmit} onClose={() => {}} />)
  fireEvent.click(screen.getByLabelText('Specific skills'))
  fireEvent.click(await screen.findByLabelText('SQL'))
  fireEvent.click(screen.getByLabelText('All skills'))
  fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ categories: ['skills'], skillIds: [], comment: '' }))
})
it('keeps the request form available after a send failure', async () => {
  render(<RequestDataAccessDialog count={1} onSubmit={vi.fn().mockRejectedValue(new Error('Could not send'))} onClose={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not send')
  expect(screen.getByRole('button', { name: 'Send request' })).toBeEnabled()
})
