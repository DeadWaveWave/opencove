import { useEffect } from 'react'
import type { UiTheme } from '@contexts/settings/domain/agentSettings'
import type { ResolvedUiTheme } from '@shared/contracts/dto'
const SYSTEM_THEME_FALLBACK: ResolvedUiTheme = 'dark'

export function useApplyUiTheme(uiTheme: UiTheme): void {
  useEffect(() => {
    const root = document.documentElement

    const applyResolvedTheme = (theme: ResolvedUiTheme): void => {
      if (root.dataset.coveTheme === theme) {
        return
      }

      root.dataset.coveTheme = theme
      root.style.colorScheme = theme
      void window.opencoveApi?.windowChrome?.setTheme?.({ theme }).catch(() => undefined)
      window.dispatchEvent(new CustomEvent('opencove-theme-changed', { detail: { theme } }))
    }

    if (uiTheme === 'light' || uiTheme === 'dark') {
      applyResolvedTheme(uiTheme)
      return undefined
    }

    if (typeof window.matchMedia !== 'function') {
      applyResolvedTheme(SYSTEM_THEME_FALLBACK)
      return undefined
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const applyFromSystem = (): void => {
      applyResolvedTheme(mediaQuery.matches ? 'dark' : 'light')
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
