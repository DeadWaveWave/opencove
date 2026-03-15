import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  AGENT_PROVIDERS,
  DEFAULT_AGENT_SETTINGS,
  type AgentProvider,
} from '../../../src/contexts/settings/domain/agentSettings'
import { SettingsPanel } from '../../../src/contexts/settings/presentation/renderer/SettingsPanel'

function createModelCatalog() {
  return AGENT_PROVIDERS.reduce<
    Record<
      AgentProvider,
      {
        models: string[]
        source: string | null
        fetchedAt: string | null
        isLoading: boolean
        error: string | null
      }
    >
  >(
    (acc, provider) => {
      acc[provider] = {
        models: [],
        source: null,
        fetchedAt: null,
        isLoading: false,
        error: null,
      }
      return acc
    },
    {} as Record<
      AgentProvider,
      {
        models: string[]
        source: string | null
        fetchedAt: string | null
        isLoading: boolean
        error: string | null
      }
    >,
  )
}

describe('SettingsPanel', () => {
  it('loads terminal profiles and persists the selected default profile', async () => {
    const onChange = vi.fn()
    const listProfiles = vi.fn(async () => ({
      profiles: [
        { id: 'powershell', label: 'PowerShell', runtimeKind: 'windows' as const },
        { id: 'wsl:Ubuntu', label: 'WSL (Ubuntu)', runtimeKind: 'wsl' as const },
      ],
      defaultProfileId: 'powershell',
    }))

    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      value: {
        pty: {
          listProfiles,
        },
      },
    })

    render(
      <SettingsPanel
        settings={DEFAULT_AGENT_SETTINGS}
        modelCatalogByProvider={createModelCatalog()}
        workspaces={[]}
        onWorkspaceWorktreesRootChange={() => undefined}
        onChange={onChange}
        onClose={() => undefined}
      />,
    )

    await waitFor(() => {
      expect(listProfiles).toHaveBeenCalledTimes(1)
    })

    const canvasNav = screen.getByTestId('settings-section-nav-canvas')
    fireEvent.click(canvasNav)

    const select = await screen.findByTestId('settings-terminal-profile')
    expect(select).toBeVisible()
    expect(screen.getByText('Automatic (PowerShell)')).toBeVisible()

    fireEvent.change(select, { target: { value: 'wsl:Ubuntu' } })

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_AGENT_SETTINGS,
      defaultTerminalProfileId: 'wsl:Ubuntu',
    })
  })
})
