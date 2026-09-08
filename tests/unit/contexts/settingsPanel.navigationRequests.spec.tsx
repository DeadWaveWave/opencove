import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EndpointOverviewProvider } from '../../../src/app/renderer/shell/components/EndpointOverviewProvider'
import { applyUiLanguage } from '../../../src/app/renderer/i18n'
import * as terminalProfilesHook from '../../../src/app/renderer/shell/hooks/useTerminalProfiles'
import {
  AGENT_PROVIDERS,
  DEFAULT_AGENT_SETTINGS,
} from '../../../src/contexts/settings/domain/agentSettings'
import { SettingsPanel } from '../../../src/contexts/settings/presentation/renderer/SettingsPanel'
import type { SettingsPageId } from '../../../src/contexts/settings/presentation/renderer/SettingsPanel.shared'

type Props = React.ComponentProps<typeof SettingsPanel>

function createProps(): Props {
  return {
    settings: DEFAULT_AGENT_SETTINGS,
    updateState: null,
    modelCatalogByProvider: Object.fromEntries(
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
    ) as Props['modelCatalogByProvider'],
    workspaces: [],
    onWorkspaceWorktreesRootChange: vi.fn(),
    onWorkspaceEnvironmentVariablesChange: vi.fn(),
    isFocusNodeTargetZoomPreviewing: false,
    onFocusNodeTargetZoomPreviewChange: vi.fn(),
    onChange: vi.fn(),
    onCheckForUpdates: vi.fn(),
    onDownloadUpdate: vi.fn(),
    onInstallUpdate: vi.fn(),
    onClose: vi.fn(),
  }
}

async function searchCodexModels() {
  fireEvent.change(screen.getByTestId('settings-panel-search'), {
    target: { value: 'codex model' },
  })
  fireEvent.click(screen.getByTestId('settings-panel-search-result-agent.codex.models'))
  await waitFor(() =>
    expect(screen.getByTestId('settings-custom-model-enabled-codex')).toHaveFocus(),
  )
}

beforeEach(async () => {
  await applyUiLanguage('en')
  vi.spyOn(terminalProfilesHook, 'useTerminalProfiles').mockReturnValue({
    terminalProfiles: [],
    detectedDefaultTerminalProfileId: null,
    refreshTerminalProfiles: async () => undefined,
  })
})

afterEach(() => vi.restoreAllMocks())

describe('SettingsPanel external navigation requests', () => {
  it.each(['initialPageId', 'openPageId'] as const)(
    'does not replay consumed provider searches after navigating away and back through %s',
    async propName => {
      const props = createProps()
      const page = (pageId: SettingsPageId) => {
        const navigation =
          propName === 'initialPageId' ? { initialPageId: pageId } : { openPageId: pageId }
        return <SettingsPanel {...props} {...navigation} />
      }
      const view = render(page('agent'), { wrapper: EndpointOverviewProvider })
      await searchCodexModels()
      expect(screen.queryByTestId('settings-agent-order-item-codex')).toBeNull()
      fireEvent.click(screen.getByTestId('settings-agent-configure-done-codex'))
      expect(screen.getByTestId('settings-agent-configure-codex')).toHaveFocus()

      view.rerender(page('terminal'))
      expect(screen.getByTestId('settings-terminal-font-size')).toBeInTheDocument()
      expect(screen.queryByTestId('settings-agent-detail-codex')).toBeNull()
      view.rerender(page('agent'))
      expect(screen.getByTestId('settings-agent-order-item-codex')).toBeVisible()
      expect(screen.queryByTestId('settings-agent-detail-codex')).toBeNull()

      // The same provider remains reachable when a later search issues a new request key.
      await searchCodexModels()
      expect(screen.getByTestId('settings-agent-detail-codex')).toBeInTheDocument()
      expect(props.onChange).not.toHaveBeenCalled()
    },
  )
})
