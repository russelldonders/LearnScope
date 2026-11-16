import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PageContent from './PageContent'
import { normalisePageDocument, startingOrder } from '../lib/pageBuilder'

// Rendered as learners see them, through PageContent and without the app's
// language provider (English fallback).
function renderBlocks(...blocks) {
  return render(<PageContent document={{ version: 1, blocks }} />)
}
const item = (id, label, detail = '', extra = {}) => ({ id, label, detail, value: 0, correct: false, ...extra })

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('knowledge check', () => {
  const question = {
    id: 'q1', type: 'knowledge_check', title: 'What does active listening involve?', layout: 'single',
    items: [
      item('a', 'Planning your reply', 'That takes your attention away from them.'),
      item('b', 'Reflecting back what you heard', 'Yes – it shows you understood.', { correct: true }),
      item('c', 'Interrupting to help', 'That cuts them off.'),
    ],
  }

  it('gives feedback on the chosen answer, then lets the learner try again', () => {
    renderBlocks(question)
    expect(screen.getByText('Choose one answer.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check answer' })).toBeDisabled()
    fireEvent.click(screen.getByRole('radio', { name: /Planning your reply/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Check answer' }))
    expect(screen.getByRole('status')).toHaveTextContent('Not quite')
    expect(screen.getByText('That takes your attention away from them.')).toBeInTheDocument()
    // The right answer is shown too, with why it's right.
    expect(screen.getByText('Yes – it shows you understood.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    fireEvent.click(screen.getByRole('radio', { name: /Reflecting back/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Check answer' }))
    expect(screen.getByRole('status')).toHaveTextContent('That’s right.')
  })

  it('needs every right answer when there are several', () => {
    renderBlocks({ ...question, layout: 'multiple', items: [...question.items.slice(0, 2), item('d', 'Asking open questions', 'Yes.', { correct: true })] })
    expect(screen.getByText('Choose all that apply.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: /Reflecting back/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Check answer' }))
    expect(screen.getByRole('status')).toHaveTextContent('Not quite')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Reflecting back/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /open questions/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Check answer' }))
    expect(screen.getByRole('status')).toHaveTextContent('That’s right.')
  })
})

it('turns flip cards over', () => {
  renderBlocks({ id: 'f', type: 'flip_cards', title: 'Key terms', items: [item('1', 'Empathy', 'Understanding how someone feels.')] })
  const card = screen.getByRole('button', { name: 'Turn over: Empathy' })
  expect(card).toHaveAttribute('aria-pressed', 'false')
  fireEvent.click(card)
  expect(card).toHaveAttribute('aria-pressed', 'true')
  expect(card).toHaveAccessibleName('Empathy: Understanding how someone feels.')
})

it('reveals a hotspot’s text when its number is selected', () => {
  renderBlocks({ id: 'h', type: 'hotspots', title: 'The coaching model', layout: 'hub', items: [item('g', 'Goal', 'What do you want?'), item('r', 'Reality', 'Where are you now?')] })
  expect(screen.queryByText('Where are you now?')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Reality' }))
  expect(screen.getByText('Where are you now?')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Reality' })).toHaveAttribute('aria-expanded', 'true')
})

it('opens reveal sections', () => {
  renderBlocks({ id: 'a', type: 'accordion', items: [item('1', 'Why it matters', 'Because…')] })
  expect(screen.getByText('Why it matters').closest('details')).not.toHaveAttribute('open')
})

describe('ordering', () => {
  const steps = [item('1', 'Listen'), item('2', 'Reflect'), item('3', 'Ask'), item('4', 'Agree a next step')]

  it('starts mixed up, the same way every time, and never already right', () => {
    const order = startingOrder(steps, 'o1')
    expect(order).not.toEqual(steps.map((step) => step.id))
    expect(startingOrder(steps, 'o1')).toEqual(order)
    expect(startingOrder([item('1', 'A'), item('2', 'B')], 'x')).toEqual(['2', '1'])
  })

  it('checks the order the learner arranges', () => {
    renderBlocks({ id: 'o1', type: 'ordering', title: 'Put the steps in order', caption: 'You listen before you respond.', items: steps })
    fireEvent.click(screen.getByRole('button', { name: 'Check order' }))
    expect(screen.getByRole('status')).toHaveTextContent('Not quite')

    // Rearrange into the right order with the arrows.
    const labels = () => within(screen.getByRole('list')).getAllByRole('listitem').map((li) => li.querySelector('.page-ordering__label').textContent)
    for (const [target, label] of ['Listen', 'Reflect', 'Ask', 'Agree a next step'].entries()) {
      while (labels().indexOf(label) > target) fireEvent.click(screen.getByRole('button', { name: `Move “${label}” up` }))
    }
    fireEvent.click(screen.getByRole('button', { name: 'Check order' }))
    expect(screen.getByRole('status')).toHaveTextContent('That’s the right order.')
    expect(screen.getByText('You listen before you respond.')).toBeInTheDocument()
  })
})

it('plays an animated explainer one step at a time', () => {
  vi.useFakeTimers()
  renderBlocks({ id: 'm', type: 'animation', title: 'How feedback lands', layout: 'flow', items: [item('1', 'Observe', 'Notice what happened.'), item('2', 'Describe', 'Say it plainly.'), item('3', 'Agree', 'Decide what next.')] })
  expect(screen.getByText('Step 1 of 3')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(screen.getByText('Step 2 of 3')).toBeInTheDocument()
  expect(screen.getByText('Say it plainly.')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Play' }))
  act(() => { vi.advanceTimersByTime(3600) })
  expect(screen.getByText('Step 3 of 3')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Watch again' })).toBeInTheDocument()
})

it('draws a chart with its figures available as text', () => {
  renderBlocks({ id: 'c', type: 'chart', title: 'Time spent', layout: 'bar', unit: 'hours', caption: 'Illustrative example', items: [item('1', 'Listening', '', { value: 4 }), item('2', 'Talking', '', { value: 2 })] })
  expect(screen.getByRole('img', { name: 'Time spent. Listening: 4 hours, Talking: 2 hours' })).toBeInTheDocument()
  expect(screen.getByRole('table')).toHaveTextContent('Listening4 hours')
  expect(screen.getByText('Illustrative example')).toBeInTheDocument()
})

it('draws a diagram and leaves out a block with nothing in it', () => {
  renderBlocks(
    { id: 'd', type: 'diagram', title: 'The cycle', layout: 'cycle', items: [item('1', 'Plan'), item('2', 'Do'), item('3', 'Review')] },
    { id: 'e', type: 'flip_cards', title: 'Empty', items: [] },
  )
  expect(screen.getByRole('list', { name: 'The cycle' })).toHaveTextContent(/Plan.*Do.*Review/)
  expect(screen.queryByText('Empty')).not.toBeInTheDocument()
})

describe('normalisePageDocument for interactive blocks', () => {
  it('keeps them as plain text with a layout it knows and a limit on items', () => {
    const page = normalisePageDocument({ blocks: [{
      id: 'x', type: 'flip_cards', title: '<b>Terms</b>',
      items: Array.from({ length: 12 }, (_, index) => ({ label: `<img src=x onerror=alert(1)>Card ${index}`, detail: 'Back' })),
    }, {
      id: 'y', type: 'chart', layout: 'radar', unit: 'hrs', items: [{ label: 'A', value: '3' }],
    }] })
    expect(page.blocks[0].title).toBe('Terms')
    expect(page.blocks[0].items).toHaveLength(8)
    expect(page.blocks[0].items[0].label).toBe('Card 0')
    expect(page.blocks[1]).toMatchObject({ layout: 'bar', unit: 'hrs', items: [{ label: 'A', value: 3 }] })
  })
})
