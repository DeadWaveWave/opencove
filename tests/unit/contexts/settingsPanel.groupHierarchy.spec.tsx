import { EndpointOverviewProvider } from '../../../src/app/renderer/shell/components/EndpointOverviewProvider'
import React from 'react'
import { fireEvent, render as renderUi, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyUiLanguage } from '../../../src/app/renderer/i18n'
import { GeneralSection } from '../../../src/contexts/settings/presentation/renderer/settingsPanel/GeneralSection'
import { WorkerSection } from '../../../src/contexts/settings/presentation/renderer/settingsPanel/WorkerSection'
import { renderFullSettingsPanel } from './settingsPanel.fullTestUtils'
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

  it('keeps all eight full-panel pages distinct from groups and routine actions quiet', async () => {
    const { container } = renderFullSettingsPanel()
    const panel = screen.getByTestId('settings-panel')
    expect(panel).toBeVisible()
    const pages = [
      'general',
      'appearance',
      'canvas',
      'agent',
      'terminal',
      'shortcuts',
      'worker',
      'experimental',
    ]
    // Each page observes the preceding panel navigation before checking its registered content.
    for (const page of pages) {
      const navTestId = `settings-section-nav-${page}`
      const nav = screen.getByTestId(navTestId)
      fireEvent.click(nav)
      await waitFor(() => expect(nav).toHaveAttribute('aria-current', 'page'))
      const title = screen.getByTestId('settings-panel-title').textContent?.trim()
      expect(title, navTestId).toBeTruthy()
      const groupTitles = Array.from(
        container.querySelectorAll('.settings-panel__group-title'),
        heading => heading.textContent?.trim(),
      )
      expect(groupTitles, `${navTestId} groups`).not.toContain(title)
      // Includes every rendered primary control, without depending on jsdom geometry.
      expect(panel.querySelectorAll('.cove-button--primary'), navTestId).toHaveLength(0)
    }
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
    const { container } = render(<WorkerSection />)

    expect(await screen.findByTestId('settings-worker-cli-status')).toBeVisible()
    const { group, body } = expectSettingsGroup('Worker Runtime')
    expect(group.querySelectorAll('.settings-panel__group-body')).toHaveLength(1)

    for (const moduleName of ['CLI', 'Local Worker']) {
      expect(within(body).getByRole('heading', { level: 4, name: moduleName })).toBeVisible()
    }

    expect(within(body).getByTestId('settings-worker-cli-status')).toBeVisible()
    expect(within(body).getByTestId('settings-worker-local-start')).toBeVisible()
    expect(container.querySelector('.settings-panel__worker-module')).not.toBeInTheDocument()
  })
})

function render(ui: React.ReactNode) {
  return renderUi(ui, { wrapper: EndpointOverviewProvider })
}
