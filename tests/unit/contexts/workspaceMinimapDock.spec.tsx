import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceMinimapDock } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceMinimapDock'

vi.mock('@xyflow/react', () => ({
  MiniMap: () => <div data-testid="workspace-minimap" />,
  useReactFlow: () => ({ setCenter: vi.fn(), getZoom: vi.fn(() => 1) }),
}))

describe('WorkspaceMinimapDock', () => {
  it('reports the toggled prop value once and keeps rendering from its prop', () => {
    const onMinimapVisibilityChange = vi.fn()
    const props = { minimapNodeColor: () => '#000', onMinimapVisibilityChange }

    const { rerender } = render(<WorkspaceMinimapDock {...props} isMinimapVisible={true} />)
    expect(screen.queryByTestId('workspace-minimap')).not.toBeNull()

    fireEvent.click(screen.getByTestId('workspace-minimap-toggle'))

    expect(onMinimapVisibilityChange).toHaveBeenCalledTimes(1)
    expect(onMinimapVisibilityChange).toHaveBeenCalledWith(false)
    // The dock owns no copy of the flag: it still follows the prop until the prop changes.
    expect(screen.queryByTestId('workspace-minimap')).not.toBeNull()

    rerender(<WorkspaceMinimapDock {...props} isMinimapVisible={false} />)
    expect(screen.queryByTestId('workspace-minimap')).toBeNull()

    fireEvent.click(screen.getByTestId('workspace-minimap-toggle'))
    expect(onMinimapVisibilityChange).toHaveBeenCalledTimes(2)
    expect(onMinimapVisibilityChange).toHaveBeenLastCalledWith(true)
  })
})
