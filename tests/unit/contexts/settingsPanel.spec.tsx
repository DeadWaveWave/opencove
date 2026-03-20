import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  AGENT_PROVIDERS,
  DEFAULT_AGENT_SETTINGS,
  type AgentProvider,
} from '../../../src/contexts/settings/domain/agentSettings'
import * as terminalProfilesHook from '../../../src/app/renderer/shell/hooks/useTerminalProfiles'
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
  it('persists the selected default profile', () => {
    const onChange = vi.fn()
    vi.spyOn(terminalProfilesHook, 'useTerminalProfiles').mockReturnValue({
      terminalProfiles: [
        { id: 'powershell', label: 'PowerShell', runtimeKind: 'windows' },
        { id: 'wsl:Ubuntu', label: 'WSL (Ubuntu)', runtimeKind: 'wsl' },
      ],
      detectedDefaultTerminalProfileId: 'powershell',
      refreshTerminalProfiles: async () => undefined,
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

    const canvasNav = screen.getByTestId('settings-section-nav-canvas')
    fireEvent.click(canvasNav)

    const trigger = screen.getByTestId('settings-terminal-profile-trigger')
    expect(trigger).toBeVisible()
    expect(screen.getByText('Automatic (PowerShell)')).toBeVisible()

    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('option', { name: 'WSL (Ubuntu)' }))

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_AGENT_SETTINGS,
      defaultTerminalProfileId: 'wsl:Ubuntu',
    })
  })

  it('allows reordering agent providers', () => {
    const onChange = vi.fn()
    vi.spyOn(terminalProfilesHook, 'useTerminalProfiles').mockReturnValue({
      terminalProfiles: [],
      detectedDefaultTerminalProfileId: null,
      refreshTerminalProfiles: async () => undefined,
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

    fireEvent.click(screen.getByTestId('settings-section-nav-agent'))
    fireEvent.click(screen.getByTestId('settings-agent-order-move-down-claude-code'))

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_AGENT_SETTINGS,
      agentProviderOrder: ['codex', 'claude-code', 'opencode', 'gemini'],
    })
  })
})
