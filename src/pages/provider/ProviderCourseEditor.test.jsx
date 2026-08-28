import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/supabaseClient', () => ({ supabase: {} }))

import { DragHandle } from './ProviderCourseEditor'

describe('DragHandle touch support', () => {
  afterEach(cleanup)

  beforeEach(() => {
    HTMLElement.prototype.setPointerCapture = vi.fn()
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => true)
    HTMLElement.prototype.releasePointerCapture = vi.fn()
  })

  it('runs the pointer drag lifecycle for touch input', () => {
    const onPointerDragStart = vi.fn()
    const onPointerDragMove = vi.fn()
    const onPointerDragEnd = vi.fn()

    render(
      <DragHandle
        label="Move lesson"
        onPointerDragStart={onPointerDragStart}
        onPointerDragMove={onPointerDragMove}
        onPointerDragEnd={onPointerDragEnd}
      />,
    )

    const handle = screen.getByRole('button', { name: /move lesson/i })
    fireEvent.pointerDown(handle, { pointerId: 4, pointerType: 'touch', clientX: 20, clientY: 200 })
    fireEvent.pointerMove(handle, { pointerId: 4, pointerType: 'touch', clientX: 20, clientY: 240 })
    fireEvent.pointerUp(handle, { pointerId: 4, pointerType: 'touch', clientX: 20, clientY: 240 })

    expect(onPointerDragStart).toHaveBeenCalledOnce()
    expect(onPointerDragMove).toHaveBeenCalledOnce()
    expect(onPointerDragEnd).toHaveBeenCalledOnce()
  })

  it('leaves mouse input to native HTML drag events', () => {
    const onPointerDragStart = vi.fn()
    render(<DragHandle label="Move lesson" onPointerDragStart={onPointerDragStart} />)

    fireEvent.pointerDown(screen.getByRole('button'), { pointerId: 1, pointerType: 'mouse' })

    expect(onPointerDragStart).not.toHaveBeenCalled()
  })
})
