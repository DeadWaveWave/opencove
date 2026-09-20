import { useMemo } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  WorkspaceCollapseContext,
  useWorkspaceCollapse,
  type WorkspaceCollapseValue,
} from '../collapse/WorkspaceCollapseContext'
import { WorkspaceSpaceCollapseActions } from './WorkspaceSpaceCollapseActions'

vi.mock('@app/renderer/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

function Harness({ value }: { value: Partial<WorkspaceCollapseValue> }) {
  const defaults = useWorkspaceCollapse()
  const contextValue = useMemo(() => ({ ...defaults, ...value }), [defaults, value])
  return (
    <WorkspaceCollapseContext.Provider value={contextValue}>
      <WorkspaceSpaceCollapseActions spaceId="space" />
    </WorkspaceCollapseContext.Provider>
  )
}

describe('Space collapse actions', () => {
  it('has a single action for compacting the actual windows, even when restore is available', () => {
    const value = {
      toggleNode: vi.fn(),
      collapseAndArrange: vi.fn(),
      undoArrange: vi.fn(),
      canUndoArrange: () => true,
    }
    render(<Harness value={value} />)
    expect(screen.getAllByRole('button')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'spaceCollapse.collapseAndArrange' }))
    expect(value.collapseAndArrange).toHaveBeenCalledWith('space')
    expect(value.toggleNode).not.toHaveBeenCalled()
    expect(value.undoArrange).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'spaceCollapse.undoArrange' })).toBeNull()
  })
})
