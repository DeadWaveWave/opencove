import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  WorkspaceCollapseContext,
  type WorkspaceCollapseValue,
} from '../collapse/WorkspaceCollapseContext'
import { WorkspaceSpaceCollapseActions } from './WorkspaceSpaceCollapseActions'

vi.mock('@app/renderer/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

function Harness({ value }: { value: WorkspaceCollapseValue }) {
  return (
    <WorkspaceCollapseContext.Provider value={value}>
      <WorkspaceSpaceCollapseActions spaceId="space" />
    </WorkspaceCollapseContext.Provider>
  )
}

describe('Space collapse actions', () => {
  it('keeps collapse, arrange, and undo as independent explicit actions', () => {
    const value: WorkspaceCollapseValue = {
      workspaceId: 'project',
      nodes: [],
      spaces: [],
      collapsedNodeIds: {},
      collapsedSpaceIds: {},
      toggleNode: vi.fn(),
      toggleSpace: vi.fn(),
      revealNode: vi.fn(),
      collapseAndArrange: vi.fn(),
      undoArrange: vi.fn(),
      canUndoArrange: () => true,
    }
    const view = render(<Harness value={value} />)
    fireEvent.click(screen.getByRole('button', { name: 'spaceCollapse.collapseAndArrange' }))
    expect(value.collapseAndArrange).toHaveBeenCalledWith('space')
    expect(value.toggleSpace).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'spaceCollapse.undoArrange' }))
    expect(value.undoArrange).toHaveBeenCalledWith('space')
    fireEvent.click(screen.getByRole('button', { name: 'spaceCollapse.collapse' }))
    expect(value.toggleSpace).toHaveBeenCalledWith('space')
    view.rerender(<Harness value={{ ...value, collapsedSpaceIds: { space: true } }} />)
    expect(
      screen.getByRole('button', { name: 'spaceCollapse.expand' }).getAttribute('aria-expanded'),
    ).toBe('false')
    expect(screen.queryByRole('button', { name: 'spaceCollapse.collapseAndArrange' })).toBeNull()
  })
})
