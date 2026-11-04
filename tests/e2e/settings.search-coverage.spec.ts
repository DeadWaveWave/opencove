import { expect, test } from '@playwright/test'
import { launchApp, seedWorkspaceState, testWorkspacePath } from './workspace-canvas.helpers'
import { CANONICAL_SETTINGS_PAGE_DEFINITIONS } from '../../src/contexts/settings/presentation/renderer/settingsPanel/settingsPageRegistry'

// Every row on every settings page must be reachable from the settings search: a new row that
// forgets its search entry fails here.
for (const language of ['en', 'zh-CN'] as const) {
  test(`every settings row can be found by search (${language})`, async () => {
    const { electronApp, window } = await launchApp()
    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'search-coverage',
        workspaces: [
          { id: 'search-coverage', name: 'Project', path: testWorkspacePath, nodes: [] },
        ],
        settings: { language },
      })
      await window.getByTestId('app-header-settings').click()

      /* eslint-disable no-await-in-loop -- Pages share one panel and searches share one field, so each step must finish before the next. */
      const rows: Array<{ page: string; label: string }> = []
      for (const page of Object.values(CANONICAL_SETTINGS_PAGE_DEFINITIONS)) {
        const nav = window.getByTestId(page.testId)
        if ((await nav.count()) === 0) {
          continue
        }
        await nav.click()
        await expect(nav).toHaveAttribute('aria-current', 'page')
        const labels = await window
          .locator('.settings-panel__row .settings-panel__row-label > :first-child')
          .allTextContents()
        for (const label of labels.map(text => text.trim()).filter(Boolean)) {
          rows.push({ page: page.canonicalPageId, label })
        }
      }
      expect(rows.length).toBeGreaterThan(40)

      const search = window.getByTestId('settings-panel-search')
      const unreachable: string[] = []
      for (const row of rows) {
        await search.fill(row.label)
        // The row's own entry, not a longer title that merely contains the label.
        const titles = window.locator('.settings-panel__search-result-title')
        const matched = await expect
          .poll(async () =>
            (await titles.allTextContents()).some(
              title => title.trim().toLocaleLowerCase() === row.label.toLocaleLowerCase(),
            ),
          )
          .toBe(true)
          .then(
            () => true,
            () => false,
          )
        if (!matched) {
          unreachable.push(`${row.page}: ${row.label}`)
        }
      }
      /* eslint-enable no-await-in-loop */
      expect(unreachable).toEqual([])
    } finally {
      await electronApp.close()
    }
  })
}
