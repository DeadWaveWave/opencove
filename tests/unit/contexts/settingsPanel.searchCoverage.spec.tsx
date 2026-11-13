/* eslint-disable no-await-in-loop -- Each page and search observes the previous panel transition. */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { applyUiLanguage } from '../../../src/app/renderer/i18n'
import { CANONICAL_SETTINGS_PAGE_DEFINITIONS } from '../../../src/contexts/settings/presentation/renderer/settingsPanel/settingsPageRegistry'
import { renderFullSettingsPanel } from './settingsPanel.fullTestUtils'

afterEach(async () => {
  cleanup()
  delete (window as { opencoveApi?: unknown }).opencoveApi
  vi.restoreAllMocks()
  await applyUiLanguage('en')
})

it.each(['en', 'zh-CN'] as const)(
  'every rendered Settings row can be found by search (%s)',
  async language => {
    await applyUiLanguage(language)
    const { container } = renderFullSettingsPanel(language)
    const rows: Array<{ page: string; label: string }> = []
    for (const page of Object.values(CANONICAL_SETTINGS_PAGE_DEFINITIONS)) {
      const nav = screen.queryByTestId(page.testId)
      if (!nav) {
        continue
      }
      fireEvent.click(nav)
      await waitFor(() => expect(nav).toHaveAttribute('aria-current', 'page'))
      const labels = Array.from(
        container.querySelectorAll(
          '.settings-panel__row .settings-panel__row-label > :first-child, .cove-setting-row__label',
        ),
        row => row.textContent?.trim() ?? '',
      ).filter(Boolean)
      for (const label of labels) {
        rows.push({ page: page.canonicalPageId, label })
      }
    }
    expect(rows.length).toBeGreaterThan(40)
    const search = screen.getByTestId('settings-panel-search')
    const unreachable: string[] = []
    for (const row of rows) {
      fireEvent.change(search, { target: { value: row.label } })
      const matched = await waitFor(() => {
        const titles = Array.from(
          container.querySelectorAll('.settings-panel__search-result-title'),
          title => title.textContent ?? '',
        )
        expect(
          titles.some(title => title.trim().toLocaleLowerCase() === row.label.toLocaleLowerCase()),
        ).toBe(true)
      }).then(
        () => true,
        () => false,
      )
      if (!matched) {
        unreachable.push(`${row.page}: ${row.label}`)
      }
    }
    expect(unreachable).toEqual([])
  },
  30_000,
)
