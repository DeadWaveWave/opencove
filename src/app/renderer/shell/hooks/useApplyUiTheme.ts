import { useEffect, useMemo } from 'react'
import { usePluginRegistry } from '@contexts/plugins/presentation/renderer/usePluginRegistry'
import { resolveHostTheme } from '@contexts/plugins/domain/pluginThemes'
import { DEFAULT_AGENT_SETTINGS } from '@contexts/settings/domain/agentSettings'
import { UI_THEME_DESCRIPTORS, type UiTheme } from '@contexts/settings/domain/agentSettings'
import type { ResolvedUiTheme } from '@shared/contracts/dto'

const SYSTEM_THEME_FALLBACK: ResolvedUiTheme = 'dark'

export function useApplyUiTheme(uiTheme: UiTheme): void {
  const { plugins } = usePluginRegistry()
  const selected = useMemo(
    () => resolveHostTheme(uiTheme, plugins, DEFAULT_AGENT_SETTINGS.uiTheme),
    [uiTheme, plugins],
  )
  useEffect(() => {
    const root = document.documentElement
    const descriptor =
      selected.theme ?? UI_THEME_DESCRIPTORS[selected.id as keyof typeof UI_THEME_DESCRIPTORS]
    const themeId = selected.id
    for (const [name, color] of Object.entries(selected.theme?.tokens ?? {})) {
      root.style.setProperty(name, color)
    }

    const applyResolved = (baseScheme: ResolvedUiTheme): void => {
      const themeChanged = root.dataset.coveTheme !== baseScheme
      root.dataset.coveTheme = baseScheme
      root.dataset.coveThemeId = themeId
      root.style.colorScheme = baseScheme

      if (themeChanged) {
        void window.opencoveApi?.windowChrome
          ?.setTheme?.({ theme: baseScheme })
          .catch(() => undefined)
      }

      window.dispatchEvent(
        new CustomEvent('opencove-theme-changed', {
          detail: { theme: baseScheme, themeId },
        }),
      )
    }

    const cleanupTokens = () => {
      for (const name of Object.keys(selected.theme?.tokens ?? {})) {
        root.style.removeProperty(name)
      }
    }

    if (descriptor.baseScheme !== 'system') {
      applyResolved(descriptor.baseScheme)
      return cleanupTokens
    }

    if (typeof window.matchMedia !== 'function') {
      applyResolved(SYSTEM_THEME_FALLBACK)
      return cleanupTokens
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
        cleanupTokens()
      }
    }

    mediaQuery.addListener(handleChange)
    return () => {
      mediaQuery.removeListener(handleChange)
      cleanupTokens()
    }
  }, [selected.id, selected.theme])
}
