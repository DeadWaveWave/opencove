import type { Page } from '@playwright/test'

/** Built-in themes as Settings → Appearance shows them: a family card plus an appearance. */
const BUILTIN_THEME_CHOICES: Record<string, readonly [family: string, mode: string]> = {
  dark: ['cove', 'dark'],
  light: ['cove', 'light'],
  system: ['cove', 'system'],
  pixel: ['pixel', 'dark'],
  'pixel-light': ['pixel', 'light'],
}

/** Chooses a theme on Settings → Appearance; plugin themes keep their own button. */
export async function chooseSettingsUiTheme(page: Page, themeId: string): Promise<void> {
  const builtin = BUILTIN_THEME_CHOICES[themeId]
  if (!builtin) {
    await page.getByTestId(`settings-ui-theme-${themeId}`).click()
    return
  }
  const [family, mode] = builtin
  await page.getByTestId(`settings-ui-theme-family-${family}`).click()
  await page.getByTestId(`settings-ui-theme-mode-${mode}`).check()
}
