import React from 'react'
import { render } from '@testing-library/react'
import { vi } from 'vitest'
import { EndpointOverviewProvider } from '../../../src/app/renderer/shell/components/EndpointOverviewProvider'
import * as terminalProfilesHook from '../../../src/app/renderer/shell/hooks/useTerminalProfiles'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { SettingsPanel } from '../../../src/contexts/settings/presentation/renderer/SettingsPanel'
import { createOverview } from './endpointsSection.testUtils'
import { installSettingsPanelWorkerApi } from './settingsPanelWorkerApiTestUtils'

/** Full registered panel; only external Desktop data is stubbed, never pages or search entries. */
export function renderFullSettingsPanel(language: 'en' | 'zh-CN' = 'en') {
  installSettingsPanelWorkerApi()
  // The full Worker page also observes endpoints and the validated Web UI configuration.
  vi.mocked(window.opencoveApi.workerClient.getConfig).mockResolvedValue({
    version: 1,
    mode: 'local',
    remote: null,
    webUi: { enabled: false, port: null, exposeOnLan: false, passwordSet: false },
    updatedAt: null,
  })
  Object.assign(window.opencoveApi, {
    controlSurface: {
      invoke: vi.fn(async ({ id }: { id: string }) => {
        if (id === 'endpoint.overview.list') {
          return { endpoints: [createOverview({})] }
        }
        throw new Error(`Unexpected Settings query: ${id}`)
      }),
    },
  })
  vi.spyOn(terminalProfilesHook, 'useTerminalProfiles').mockReturnValue({
    terminalProfiles: [],
    detectedDefaultTerminalProfileId: null,
    refreshTerminalProfiles: async () => undefined,
  })
  return render(
    <SettingsPanel
      settings={{ ...DEFAULT_AGENT_SETTINGS, language }}
      updateState={null}
      modelCatalogByProvider={
        {} as React.ComponentProps<typeof SettingsPanel>['modelCatalogByProvider']
      }
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
    />,
    { wrapper: EndpointOverviewProvider },
  )
}
