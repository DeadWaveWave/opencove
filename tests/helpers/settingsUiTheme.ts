import type { Page } from '@playwright/test'

/** Cove's own appearances, as Settings → Appearance shows them: one pixel miniature each. */
const BUILTIN_APPEARANCES = new Set(['light', 'dark', 'system'])

/** Chooses a theme on Settings → Appearance; plugin themes keep their own button. */
export async function chooseSettingsUiTheme(page: Page, themeId: string): Promise<void> {
  if (!BUILTIN_APPEARANCES.has(themeId)) {
    await page.getByTestId(`settings-ui-theme-${themeId}`).click()
    return
  }
  // The radio lies, invisible, over its miniature: the pointer presses it directly.
  await page.getByTestId(`settings-ui-theme-mode-${themeId}`).check()
}
