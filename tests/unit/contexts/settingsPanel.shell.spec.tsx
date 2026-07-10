import React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as terminalProfilesHook from '../../../src/app/renderer/shell/hooks/useTerminalProfiles'
import {
  AGENT_PROVIDERS,
  DEFAULT_AGENT_SETTINGS,
} from '../../../src/contexts/settings/domain/agentSettings'
import { SettingsPanel } from '../../../src/contexts/settings/presentation/renderer/SettingsPanel'
import type { WorkspaceState } from '../../../src/contexts/workspace/presentation/renderer/types'

type SettingsPanelProps = React.ComponentProps<typeof SettingsPanel>

function createModelCatalog(): SettingsPanelProps['modelCatalogByProvider'] {
  return Object.fromEntries(
    AGENT_PROVIDERS.map(provider => [
      provider,
      {
        models: [],
        source: null,
        fetchedAt: null,
        isLoading: false,
        error: null,
      },
    ]),
  ) as SettingsPanelProps['modelCatalogByProvider']
}

function renderSettingsPanel(overrides: Partial<SettingsPanelProps> = {}) {
  vi.spyOn(terminalProfilesHook, 'useTerminalProfiles').mockReturnValue({
    terminalProfiles: [],
    detectedDefaultTerminalProfileId: null,
    refreshTerminalProfiles: async () => undefined,
  })

  return render(
    <SettingsPanel
      settings={DEFAULT_AGENT_SETTINGS}
      updateState={null}
      modelCatalogByProvider={createModelCatalog()}
      workspaces={[]}
      onWorkspaceWorktreesRootChange={() => undefined}
      onWorkspaceEnvironmentVariablesChange={() => undefined}
      isFocusNodeTargetZoomPreviewing={false}
      onFocusNodeTargetZoomPreviewChange={() => undefined}
      onChange={() => undefined}
      onCheckForUpdates={() => undefined}
      onDownloadUpdate={() => undefined}
      onInstallUpdate={() => undefined}
      onClose={() => undefined}
      {...overrides}
    />,
  )
}

function createWorkspace(): WorkspaceState {
  return {
    id: 'workspace-1',
    name: 'Cove App',
    path: '/Users/example/cove',
    worktreesRoot: '.opencove/worktrees',
    environmentVariables: {},
    nodes: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    isMinimapVisible: false,
    spaces: [],
    activeSpaceId: null,
    spaceArchiveRecords: [],
  }
}

describe('SettingsPanel shell', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exposes modal dialog semantics and a meaningfully named close button', () => {
    renderSettingsPanel()

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(within(dialog).getByRole('button', { name: /close/i })).toBeVisible()
  })

  it('updates the page heading when primary navigation changes pages', () => {
    renderSettingsPanel()

    fireEvent.click(screen.getByTestId('settings-section-nav-appearance'))

    expect(screen.getByRole('heading', { level: 2, name: 'Display & Fonts' })).toBeVisible()
  })

  it('groups primary navigation and omits secondary aliases from the sidebar', () => {
    renderSettingsPanel()

    const sidebar = screen.getByLabelText('Settings sections')
    for (const groupName of ['Application', 'Workspace', 'Connections', 'Advanced']) {
      expect(within(sidebar).getByRole('group', { name: groupName })).toBeVisible()
    }

    expect(within(sidebar).queryByTestId('settings-section-nav-shortcuts')).not.toBeInTheDocument()
    expect(within(sidebar).queryByTestId('settings-section-nav-quick-menu')).not.toBeInTheDocument()
    expect(
      within(sidebar).queryByTestId('settings-section-nav-diagnostics'),
    ).not.toBeInTheDocument()
  })

  it('selects the theme search result with ArrowDown and Enter', () => {
    renderSettingsPanel()

    const search = screen.getByRole('searchbox', { name: 'Search settings' })
    fireEvent.change(search, { target: { value: 'theme' } })
    expect(screen.getByTestId('settings-panel-search-result-general.theme')).toBeVisible()

    fireEvent.keyDown(search, { key: 'ArrowDown', code: 'ArrowDown' })
    fireEvent.keyDown(search, { key: 'Enter', code: 'Enter' })

    expect(screen.getByRole('heading', { level: 2, name: 'Display & Fonts' })).toBeVisible()
    const appearanceSection = document.getElementById('settings-section-appearance')
    expect(appearanceSection).not.toBeNull()
    expect(within(appearanceSection as HTMLElement).getByText('Appearance')).toBeVisible()
  })

  it('clears a non-empty search with Escape without closing settings', () => {
    const onClose = vi.fn()
    renderSettingsPanel({ onClose })

    const search = screen.getByRole('searchbox', { name: 'Search settings' })
    fireEvent.change(search, { target: { value: 'theme' } })
    fireEvent.keyDown(search, { key: 'Escape', code: 'Escape' })

    expect(search).toHaveValue('')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes settings with Escape when search is empty', () => {
    const onClose = vi.fn()
    renderSettingsPanel({ onClose })

    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Search settings' }), {
      key: 'Escape',
      code: 'Escape',
    })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('gives notification toggles accessible names', () => {
    renderSettingsPanel()

    fireEvent.click(screen.getByTestId('settings-section-nav-notifications'))

    for (const checkbox of screen.getAllByRole('checkbox')) {
      expect(checkbox).toHaveAccessibleName()
    }
  })

  it('keeps project settings in a collapsible navigation group', () => {
    renderSettingsPanel({ workspaces: [createWorkspace()] })

    expect(screen.getByText('Cove App')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse projects' }))

    expect(screen.queryByText('Cove App')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand projects' })).toBeVisible()
  })
})
