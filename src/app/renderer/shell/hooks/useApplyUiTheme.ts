import { useEffect } from 'react'
import { UI_THEME_DESCRIPTORS, type UiTheme } from '@contexts/settings/domain/agentSettings'
import type { ResolvedUiTheme } from '@shared/contracts/dto'

const SYSTEM_THEME_FALLBACK: ResolvedUiTheme = 'dark'

export function useApplyUiTheme(uiTheme: UiTheme): void {
  useEffect(() => {
    const root = document.documentElement
    const descriptor = UI_THEME_DESCRIPTORS[uiTheme]

    const applyResolved = (baseScheme: ResolvedUiTheme): void => {
      const themeChanged = root.dataset.coveTheme !== baseScheme
      const themeIdChanged = root.dataset.coveThemeId !== uiTheme

      if (!themeChanged && !themeIdChanged) {
        return
      }

      root.dataset.coveTheme = baseScheme
      root.dataset.coveThemeId = uiTheme
      root.style.colorScheme = baseScheme

      if (themeChanged) {
        void window.opencoveApi?.windowChrome
          ?.setTheme?.({ theme: baseScheme })
          .catch(() => undefined)
      }

      window.dispatchEvent(
        new CustomEvent('opencove-theme-changed', {
          detail: { theme: baseScheme, themeId: uiTheme },
        }),
      )
    }

    if (descriptor.baseScheme !== 'system') {
      applyResolved(descriptor.baseScheme)
      return undefined
    }

    if (typeof window.matchMedia !== 'function') {
      applyResolved(SYSTEM_THEME_FALLBACK)
      return undefined
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const applyFromSystem = (): void => {
      applyResolved(mediaQuery.matches ? 'dark' : 'light')
    }

    applyFromSystem()

    const handleChange = (): void => {
      applyFromSystem()
    }

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange)
      return () => {
        mediaQuery.removeEventListener('change', handleChange)
      }
    }

    mediaQuery.addListener(handleChange)
    return () => {
      mediaQuery.removeListener(handleChange)
    }
  }, [uiTheme])
}
