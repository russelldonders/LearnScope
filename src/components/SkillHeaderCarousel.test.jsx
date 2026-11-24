import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../context/LanguageContext', async () => {
  const { english } = await import('../lib/i18n/translations')
  const t = (key, params) => {
    const value = key.split('.').reduce((v, part) => v?.[part], english) ?? key
    return typeof value === 'string' && params ? value.replace(/\{(\w+)\}/g, (m, name) => (name in params ? params[name] : m)) : value
  }
  return { useLanguage: () => ({ language: 'en', setLanguage: vi.fn(), t }) }
})

const { default: SkillHeaderCarousel } = await import('./SkillHeaderCarousel')

const slide = (key, text) => ({ key, content: <p>{text}</p> })
const three = [slide('a', 'Due'), slide('b', 'Target'), slide('c', 'Recommended')]
// The card shown: the only slide not hidden from assistive technology.
const shown = () => screen.getByRole('group').textContent

afterEach(cleanup)

describe('SkillHeaderCarousel', () => {
  it('shows a single card on its own, with no slider controls', () => {
    render(<SkillHeaderCarousel slides={[slide('a', 'Only card')]} />)
    expect(screen.getByText('Only card')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
  })

  it('shows nothing without cards', () => {
    const { container } = render(<SkillHeaderCarousel slides={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('slides from the first card to the last, one at a time, without wrapping round', () => {
    render(<SkillHeaderCarousel slides={three} />)
    expect(screen.getByRole('region', { name: 'What’s next for this skill' })).toBeInTheDocument()
    expect(shown()).toBe('Due')
    expect(screen.getByRole('group')).toHaveAccessibleName('1 of 3')
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(shown()).toBe('Target')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(shown()).toBe('Recommended')
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(shown()).toBe('Target')
  })

  it('keeps cards it isn’t showing out of reach', () => {
    render(<SkillHeaderCarousel slides={[slide('a', 'Due'), { key: 'b', content: <button type="button">Hidden action</button> }]} />)
    expect(screen.queryByRole('button', { name: 'Hidden action' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('button', { name: 'Hidden action' })).toBeInTheDocument()
  })

  it('jumps to a card from its dot, marking the one shown', () => {
    render(<SkillHeaderCarousel slides={three} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show 3 of 3' }))
    expect(shown()).toBe('Recommended')
    expect(screen.getByRole('button', { name: 'Show 3 of 3' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: 'Show 1 of 3' })).not.toHaveAttribute('aria-current')
  })

  it('moves on a swipe, but not past either end', () => {
    render(<SkillHeaderCarousel slides={[slide('a', 'Due'), slide('b', 'Target')]} />)
    const slider = screen.getByRole('region', { name: 'What’s next for this skill' })
    const swipe = (from, to) => {
      fireEvent.touchStart(slider, { touches: [{ clientX: from }] })
      fireEvent.touchEnd(slider, { changedTouches: [{ clientX: to }] })
    }
    swipe(200, 300)
    expect(shown()).toBe('Due')
    swipe(300, 200)
    expect(shown()).toBe('Target')
    swipe(300, 200)
    expect(shown()).toBe('Target')
  })

  it('stays on a card that exists when cards go away', () => {
    const { rerender } = render(<SkillHeaderCarousel slides={three} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show 3 of 3' }))
    rerender(<SkillHeaderCarousel slides={[slide('a', 'Due'), slide('b', 'Target')]} />)
    expect(shown()).toBe('Target')
  })
})
