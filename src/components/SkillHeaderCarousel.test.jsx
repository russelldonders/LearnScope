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

afterEach(cleanup)

describe('SkillHeaderCarousel', () => {
  it('shows a single card on its own, with no carousel controls', () => {
    render(<SkillHeaderCarousel slides={[slide('a', 'Only card')]} />)
    expect(screen.getByText('Only card')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
  })

  it('shows nothing without cards', () => {
    const { container } = render(<SkillHeaderCarousel slides={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows one card at a time, in order, moving with the arrows and wrapping round', () => {
    render(<SkillHeaderCarousel slides={[slide('a', 'Due'), slide('b', 'Target'), slide('c', 'Recommended')]} />)
    expect(screen.getByRole('region', { name: 'What’s next for this skill' })).toBeInTheDocument()
    expect(screen.getByText('Due')).toBeVisible()
    expect(screen.getByText('Target')).not.toBeVisible()
    expect(screen.getByRole('group', { name: '1 of 3' })).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Target')).toBeVisible()
    expect(screen.getByText('Due')).not.toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Recommended')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Due')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(screen.getByText('Recommended')).toBeVisible()
  })

  it('jumps to a card from its dot, marking the one shown', () => {
    render(<SkillHeaderCarousel slides={[slide('a', 'Due'), slide('b', 'Target'), slide('c', 'Recommended')]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show 3 of 3' }))
    expect(screen.getByText('Recommended')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Show 3 of 3' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: 'Show 1 of 3' })).not.toHaveAttribute('aria-current')
  })

  it('moves on a swipe', () => {
    render(<SkillHeaderCarousel slides={[slide('a', 'Due'), slide('b', 'Target')]} />)
    const carousel = screen.getByRole('region', { name: 'What’s next for this skill' })
    fireEvent.touchStart(carousel, { touches: [{ clientX: 300 }] })
    fireEvent.touchEnd(carousel, { changedTouches: [{ clientX: 200 }] })
    expect(screen.getByText('Target')).toBeVisible()
  })

  it('stays on a card that exists when cards go away', () => {
    const { rerender } = render(<SkillHeaderCarousel slides={[slide('a', 'Due'), slide('b', 'Target'), slide('c', 'Recommended')]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show 3 of 3' }))
    rerender(<SkillHeaderCarousel slides={[slide('a', 'Due'), slide('b', 'Target')]} />)
    expect(screen.getByText('Target')).toBeVisible()
  })
})
