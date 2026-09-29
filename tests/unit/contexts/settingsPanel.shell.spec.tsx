import { EndpointOverviewProvider } from '../../../src/app/renderer/shell/components/EndpointOverviewProvider'
import React from 'react'
import { fireEvent, render as renderUi, screen, waitFor, within } from '@testing-library/react'
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

  it('exposes a named settings region and a meaningfully named close button', async () => {
    renderSettingsPanel()

    const panel = screen.getByTestId('settings-panel')
    expect(panel).toBe(screen.getByRole('region', { name: 'Settings', exact: true }))
    expect(panel).not.toHaveAttribute('aria-modal')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(within(panel).getByTestId('settings-panel-close')).toHaveAccessibleName(/close/i)
    await waitFor(() => {
      expect(within(panel).getByRole('searchbox', { name: 'Search settings' })).toHaveFocus()
    })
  })

  it('updates the page heading when primary navigation changes pages', () => {
    renderSettingsPanel()

    fireEvent.click(screen.getByTestId('settings-section-nav-appearance'))

    expect(screen.getByRole('heading', { level: 2, name: 'Appearance' })).toBeVisible()
  })

  it('includes plugin management alongside the primary pages and Advanced', () => {
    renderSettingsPanel()
    const sidebar = screen.getByRole('complementary', { name: 'Settings sections' })
    for (const page of [
      'general',
      'appearance',
      'canvas',
      'agent',
      'plugins',
      'terminal',
      'shortcuts',
      'worker',
      'experimental',
    ]) {
      expect(within(sidebar).getByTestId(`settings-section-nav-${page}`)).toBeVisible()
    }
    expect(sidebar.querySelectorAll('[data-testid^="settings-section-nav-"]')).toHaveLength(9)
    for (const alias of [
      'notifications',
      'integrations',
      'task-configuration',
      'quick-menu',
      'diagnostics',
    ]) {
      expect(within(sidebar).queryByTestId(`settings-section-nav-${alias}`)).not.toBeInTheDocument()
    }
  })

  it('selects the theme search result with ArrowDown and Enter', () => {
    renderSettingsPanel()

    const search = screen.getByRole('searchbox', { name: 'Search settings' })
    fireEvent.change(search, { target: { value: 'theme' } })
    expect(screen.getByTestId('settings-panel-search-result-general.theme')).toBeVisible()

    fireEvent.keyDown(search, { key: 'ArrowDown', code: 'ArrowDown' })
    fireEvent.keyDown(search, { key: 'Enter', code: 'Enter' })

    expect(screen.getByRole('heading', { level: 2, name: 'Appearance' })).toBeVisible()
    const appearanceSection = document.getElementById('settings-section-appearance')
    expect(appearanceSection).not.toBeNull()
    expect(
      within(appearanceSection as HTMLElement).getByTestId('settings-ui-theme'),
    ).toHaveAccessibleName('Appearance')
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

    fireEvent.click(screen.getByTestId('settings-section-nav-general'))
    expect(document.getElementById('settings-section-notifications')).not.toBeNull()

    for (const checkbox of screen.getAllByRole('checkbox')) {
      expect(checkbox).toHaveAccessibleName()
    }
  })

  it('switches project scope independently from application pages', () => {
    renderSettingsPanel({ workspaces: [createWorkspace()] })
    expect(screen.getByTestId('settings-panel-scope-selector-trigger')).toHaveAccessibleName(
      'Settings scope',
    )
    fireEvent.click(screen.getByTestId('settings-panel-scope-selector-trigger'))
    fireEvent.click(screen.getByRole('option', { name: 'Cove App', exact: true }))
    expect(screen.getByTestId('settings-panel-scope-selector')).toHaveValue('workspace:workspace-1')
    expect(screen.getByRole('heading', { level: 2, name: 'Cove App' })).toBeVisible()
    expect(screen.getByTestId('settings-worktree-root')).toBeVisible()
    expect(screen.queryByTestId('settings-section-nav-agent')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('settings-panel-scope-selector-trigger'))
    const app = document.querySelector<HTMLElement>('[data-cove-select-option-value="app"]')
    expect(app).not.toBeNull()
    fireEvent.click(app!)
    expect(screen.getByTestId('settings-panel-scope-selector')).toHaveValue('app')
    expect(screen.getByTestId('settings-section-nav-agent')).toBeVisible()
    fireEvent.click(screen.getByTestId('settings-panel-page-selector-trigger'))
    const pages = within(screen.getByTestId('settings-panel-page-selector-menu'))
    expect(pages.getAllByRole('option')).toHaveLength(9)
    expect(pages.getByRole('option', { name: 'Plugins', exact: true })).toBeVisible()
    expect(pages.queryByRole('option', { name: 'Cove App' })).not.toBeInTheDocument()
  })
})

function render(ui: React.ReactNode) {
  return renderUi(ui, { wrapper: EndpointOverviewProvider })
}
