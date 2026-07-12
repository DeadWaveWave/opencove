import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AddProjectWizardWindow } from '../../../src/app/renderer/shell/components/AddProjectWizardWindow'

describe('AddProjectWizardWindow', () => {
  const selectDirectory = vi.fn()

  beforeEach(() => {
    selectDirectory.mockReset()
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      value: {
        meta: { runtime: 'electron' },
        workerClient: {
          getConfig: vi.fn(async () => ({ mode: 'standalone' })),
        },
        workspace: { selectDirectory },
        controlSurface: {
          invoke: vi.fn(async () => ({ endpoints: [] })),
        },
      },
    })
  })

  it('opens the native folder picker directly for local-only project creation', async () => {
    selectDirectory.mockResolvedValue(null)
    const onClose = vi.fn()

    render(
      <AddProjectWizardWindow
        existingWorkspaces={[]}
        remoteWorkersEnabled={false}
        onClose={onClose}
        onRequestOpenEndpoints={() => undefined}
      />,
    )

    await waitFor(() => {
      expect(selectDirectory).toHaveBeenCalledTimes(1)
      expect(onClose).toHaveBeenCalledTimes(1)
    })
    expect(screen.queryByTestId('workspace-project-create-window')).not.toBeInTheDocument()
  })

  it('uses a compact anchored source picker for remote-enabled projects', async () => {
    render(
      <AddProjectWizardWindow
        anchor={{ x: 188, y: 72 }}
        existingWorkspaces={[]}
        remoteWorkersEnabled
        onClose={() => undefined}
        onRequestOpenEndpoints={() => undefined}
      />,
    )

    const popover = screen.getByTestId('workspace-project-create-window')
    expect(popover).toHaveAttribute('aria-modal', 'false')
    expect(popover).toHaveStyle({ left: '188px', top: '72px' })
    expect(screen.queryByTestId('workspace-project-create-name')).not.toBeInTheDocument()
    expect(screen.queryByTestId('workspace-project-create-backdrop')).not.toBeInTheDocument()
    expect(selectDirectory).not.toHaveBeenCalled()
  })
})
