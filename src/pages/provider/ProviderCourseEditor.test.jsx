import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/supabaseClient', () => ({ supabase: {} }))

import { DragHandle, reorderById } from './ProviderCourseEditor'

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

describe('reorderById', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]

  it('moves the dragged item to sit right before the target, dragging downward', () => {
    const result = reorderById(list, 'a', 'c', 'id', 'before')
    expect(result.map((i) => i.id)).toEqual(['b', 'a', 'c', 'd'])
  })

  it('moves the dragged item to sit right after the target, dragging downward', () => {
    const result = reorderById(list, 'a', 'c', 'id', 'after')
    expect(result.map((i) => i.id)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('moves the dragged item to sit right before the target, dragging upward', () => {
    const result = reorderById(list, 'd', 'b', 'id', 'before')
    expect(result.map((i) => i.id)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('moves the dragged item to sit right after the target, dragging upward', () => {
    const result = reorderById(list, 'd', 'b', 'id', 'after')
    expect(result.map((i) => i.id)).toEqual(['a', 'b', 'd', 'c'])
  })

  it('is a no-op when dropping after the item immediately before it', () => {
    const result = reorderById(list, 'b', 'a', 'id', 'after')
    expect(result).toBe(list)
  })

  it('is a no-op when dropping before the item immediately after it', () => {
    const result = reorderById(list, 'a', 'b', 'id', 'before')
    expect(result).toBe(list)
  })

  it('is a no-op when dropped on itself', () => {
    expect(reorderById(list, 'a', 'a', 'id', 'before')).toBe(list)
  })

  it('is a no-op when there is no target', () => {
    expect(reorderById(list, 'a', null, 'id', 'before')).toBe(list)
  })
})
