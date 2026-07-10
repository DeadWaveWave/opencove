import React from 'react'
import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyUiLanguage } from '../../../src/app/renderer/i18n'
import { GeneralSection } from '../../../src/contexts/settings/presentation/renderer/settingsPanel/GeneralSection'
import { WorkerSection } from '../../../src/contexts/settings/presentation/renderer/settingsPanel/WorkerSection'
import { installSettingsPanelWorkerApi } from './settingsPanelWorkerApiTestUtils'

const noop = (): void => undefined

function expectSettingsGroup(name: string): {
  group: HTMLElement
  body: HTMLElement
} {
  const group = screen.getByRole('group', { name })
  const directChildren = Array.from(group.children)
  const header = directChildren.find(element =>
    element.classList.contains('settings-panel__group-header'),
  )
  const body = directChildren.find(element =>
    element.classList.contains('settings-panel__group-body'),
  )
  const heading = within(group).getByRole('heading', { level: 3, name })

  expect(header).toBeInstanceOf(HTMLElement)
  expect(body).toBeInstanceOf(HTMLElement)
  expect(header).toContainElement(heading)
  expect(body).not.toContainElement(heading)

  return { group, body: body as HTMLElement }
}

describe('Settings group hierarchy', () => {
  beforeEach(async () => {
    await applyUiLanguage('en')
  })

  afterEach(() => {
    delete (window as { opencoveApi?: unknown }).opencoveApi
    vi.restoreAllMocks()
  })

  it('uses named groups with separate headers and bodies for General settings', () => {
    render(
      <GeneralSection
        language="en"
        updatePolicy="prompt"
        updateChannel="stable"
        updateState={null}
        onChangeLanguage={noop}
        onChangeUpdatePolicy={noop}
        onChangeUpdateChannel={noop}
        onCheckForUpdates={noop}
        onDownloadUpdate={noop}
        onInstallUpdate={noop}
      />,
    )

    expectSettingsGroup('Language & Region')
    expectSettingsGroup('Software Updates')
  })

  it('uses one Worker Runtime body with module headings instead of nested module cards', async () => {
    installSettingsPanelWorkerApi()
    const { container } = render(<WorkerSection remoteWorkersEnabled={false} />)

    expect(await screen.findByTestId('settings-worker-cli-status')).toBeVisible()
    const { group, body } = expectSettingsGroup('Worker Runtime')
    expect(group.querySelectorAll('.settings-panel__group-body')).toHaveLength(1)

    for (const moduleName of ['Worker Mode', 'CLI', 'Local Worker']) {
      expect(within(body).getByRole('heading', { level: 4, name: moduleName })).toBeVisible()
    }

    expect(within(body).getByTestId('settings-worker-cli-status')).toBeVisible()
    expect(within(body).getByTestId('settings-worker-local-start')).toBeVisible()
    expect(container.querySelector('.settings-panel__worker-module')).not.toBeInTheDocument()
  })
})
