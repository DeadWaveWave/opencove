import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SpaceMinimapModel } from '../utils/spaceMinimap'
import { SidebarSpaceMinimap } from './SidebarSpaceMinimap'

const model: SpaceMinimapModel = {
  aspectRatio: 2,
  workingCount: 1,
  waitingCount: 1,
  windows: [
    {
      nodeId: 'agent',
      title: 'Refactor auth',
      family: 'ai',
      status: 'working',
      left: 0,
      top: 0,
      width: 0.5,
      height: 0.5,
    },
    {
      nodeId: 'note',
      title: 'Notes',
      family: 'knowledge',
      status: null,
      left: 0.5,
      top: 0.5,
      width: 0.25,
      height: 0.5,
    },
  ],
}

function renderMinimap() {
  const onSelectWindow = vi.fn()
  const onSelectSpace = vi.fn()
  render(
    <SidebarSpaceMinimap
      model={model}
      testId="minimap"
      onSelectWindow={onSelectWindow}
      onSelectSpace={onSelectSpace}
    />,
  )
  return { onSelectWindow, onSelectSpace, minimap: screen.getByTestId('minimap') }
}

describe('SidebarSpaceMinimap', () => {
  it('draws each window in its frame position, kind family and status', () => {
    const { minimap } = renderMinimap()
    expect(minimap.style.aspectRatio).toBe('2 / 1')
    const agent = minimap.querySelector<HTMLElement>('[data-node-id="agent"]')!
    expect(agent.dataset.family).toBe('ai')
    expect(agent.dataset.status).toBe('working')
    expect(agent.style.width).toBe('50%')
    const note = minimap.querySelector<HTMLElement>('[data-node-id="note"]')!
    expect(note.dataset.status).toBeUndefined()
    expect(note.style.left).toBe('50%')
  })

  it('flies to a window when its square is clicked and to the Space elsewhere', () => {
    const { minimap, onSelectWindow, onSelectSpace } = renderMinimap()
    fireEvent.click(minimap.querySelector('[data-node-id="note"]')!)
    expect(onSelectWindow).toHaveBeenCalledWith('note')
    expect(onSelectSpace).not.toHaveBeenCalled()
    fireEvent.click(minimap)
    expect(onSelectSpace).toHaveBeenCalledTimes(1)
  })

  it('stays out of the accessibility tree', () => {
    const { minimap } = renderMinimap()
    expect(minimap.getAttribute('aria-hidden')).toBe('true')
  })
})
