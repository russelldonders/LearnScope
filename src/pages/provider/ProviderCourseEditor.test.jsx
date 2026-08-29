import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/supabaseClient', () => ({ supabase: {} }))

import { DragHandle } from './ProviderCourseEditor'

describe('DragHandle touch support', () => {
  afterEach(cleanup)

  it('runs the touch drag lifecycle via raw touch events, not Pointer Events', () => {
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
    fireEvent.touchStart(handle, { touches: [{ clientX: 20, clientY: 200 }] })
    fireEvent.touchMove(handle, { touches: [{ clientX: 20, clientY: 240 }] })
    fireEvent.touchEnd(handle, { changedTouches: [{ clientX: 20, clientY: 240 }] })

    expect(onPointerDragStart).toHaveBeenCalledOnce()
    expect(onPointerDragMove).toHaveBeenCalledOnce()
    expect(onPointerDragEnd).toHaveBeenCalledOnce()
  })

  it('ignores touch handling while disabled', () => {
    const onPointerDragStart = vi.fn()
    render(<DragHandle label="Move lesson" disabled onPointerDragStart={onPointerDragStart} />)

    fireEvent.touchStart(screen.getByRole('button'), { touches: [{ clientX: 20, clientY: 200 }] })

    expect(onPointerDragStart).not.toHaveBeenCalled()
  })

  it('leaves mouse input to native HTML drag events', () => {
    const onDragStart = vi.fn()
    render(<DragHandle label="Move lesson" onDragStart={onDragStart} />)

    fireEvent.dragStart(screen.getByRole('button'))

    expect(onDragStart).toHaveBeenCalledOnce()
  })
})
