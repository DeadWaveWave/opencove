import { useEffect, useMemo } from 'react'
import { usePluginRegistry } from '@contexts/plugins/presentation/renderer/usePluginRegistry'
import { usePluginDetails } from '@contexts/plugins/presentation/renderer/usePluginDetails'
import { publishThemeApplication } from '@contexts/plugins/presentation/renderer/themeApplication'
import { applyThemeMotion } from '@contexts/plugins/presentation/renderer/themeMotion'
import { resolveHostTheme } from '@contexts/plugins/domain/pluginThemes'
import { pluginThemeMetricTokens } from '@contexts/plugins/domain/pluginThemeMetrics'
import {
  DEFAULT_AGENT_SETTINGS,
  UI_THEME_DESCRIPTORS,
  type UiTheme,
} from '@contexts/settings/domain/agentSettings'
import { DEFAULT_UI_THEME } from '@contexts/settings/domain/uiSettings'
import type { ResolvedUiTheme } from '@shared/contracts/dto'

const SYSTEM_THEME_FALLBACK: ResolvedUiTheme = 'dark'

/** One lifecycle owns host theme styles; desired selection stays in application settings. */
export function useApplyUiTheme(uiTheme: UiTheme): void {
  const { plugins } = usePluginRegistry()
  const selected = useMemo(
    () => resolveHostTheme(uiTheme, plugins, DEFAULT_AGENT_SETTINGS.uiTheme),
    [uiTheme, plugins],
  )
  const { detail, error } = usePluginDetails(
    selected.theme?.stylesheet ? (selected.plugin ?? null) : null,
  )
  const stylesheet = selected.theme?.stylesheet
    ? detail?.themeStyles?.[selected.theme.id]
    : undefined
  const fonts = selected.theme ? detail?.themeFonts?.[selected.theme.id] : undefined

  useEffect(() => {
    const root = document.documentElement
    const requiresStyles = Boolean(selected.theme?.stylesheet)
    const loading = requiresStyles && !detail && !error
    const failed = requiresStyles && !loading && (Boolean(error) || stylesheet === undefined)
    const theme = loading || failed ? undefined : selected.theme
    const themeId =
      theme || !requiresStyles
        ? selected.id
        : loading
          ? (selected.theme?.extends ?? selected.theme?.appearance ?? DEFAULT_UI_THEME)
          : DEFAULT_UI_THEME
    const descriptor = theme ?? UI_THEME_DESCRIPTORS[themeId as keyof typeof UI_THEME_DESCRIPTORS]
    const baseId = theme?.extends ?? theme?.appearance ?? themeId
    // Plugin themes inherit the family of their foundation; generated tokens key off it.
    const family = UI_THEME_DESCRIPTORS[baseId as keyof typeof UI_THEME_DESCRIPTORS].family
    const tokens = { ...(theme?.tokens ?? {}), ...pluginThemeMetricTokens(theme ?? {}) }
    const previous = new Map<string, string>()
    const style = theme && stylesheet !== undefined ? document.createElement('style') : null
    if (style) {
      style.dataset.coveThemeStylesheet = themeId
      style.textContent = stylesheet!
      document.head.appendChild(style)
    }
    for (const [name, value] of Object.entries(tokens)) {
      previous.set(name, root.style.getPropertyValue(name))
      root.style.setProperty(name, value)
    }
    const disposeMotion = applyThemeMotion(theme?.motion)
    let disposed = false
    const emit = () => {
      if (!disposed) {
        window.dispatchEvent(
          new CustomEvent('opencove-theme-changed', {
            detail: { theme: root.dataset.coveTheme, themeId },
          }),
        )
      }
    }
    const applyResolved = (baseScheme: ResolvedUiTheme): void => {
      const changed = root.dataset.coveTheme !== baseScheme
      root.dataset.coveTheme = baseScheme
      root.dataset.coveThemeId = themeId
      root.dataset.coveThemeBase = baseId === 'system' ? baseScheme : baseId
      root.dataset.coveFamily = family
      root.style.colorScheme = baseScheme
      publishThemeApplication(
        {
          requestedId: uiTheme,
          appliedId: themeId,
          loading,
          error: failed ? (error ?? 'The selected theme stylesheet is unavailable.') : null,
        },
        theme ? fonts : [],
      )
      if (changed) {
        void window.opencoveApi?.windowChrome
          ?.setTheme?.({ theme: baseScheme })
          .catch(() => undefined)
      }
      emit()
    }
    const cleanup = () => {
      disposed = true
      disposeMotion()
      style?.remove()
      document.fonts?.removeEventListener?.('loadingdone', emit)
      document.fonts?.removeEventListener?.('loadingerror', emit)
      for (const [name, value] of previous) {
        if (value) {
          root.style.setProperty(name, value)
        } else {
          root.style.removeProperty(name)
        }
      }
    }
    // Fonts may settle after layout; consumers recalculate without remounting their runtimes.
    document.fonts?.addEventListener?.('loadingdone', emit)
    document.fonts?.addEventListener?.('loadingerror', emit)
    if (descriptor.baseScheme !== 'system') {
      applyResolved(descriptor.baseScheme)
      return cleanup
    }
    if (typeof window.matchMedia !== 'function') {
      applyResolved(SYSTEM_THEME_FALLBACK)
      return cleanup
    }
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const applyFromSystem = () => applyResolved(mediaQuery.matches ? 'dark' : 'light')
    applyFromSystem()
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', applyFromSystem)
      return () => {
        mediaQuery.removeEventListener('change', applyFromSystem)
        cleanup()
      }
    }
    mediaQuery.addListener(applyFromSystem)
    return () => {
      mediaQuery.removeListener(applyFromSystem)
      cleanup()
    }
  }, [uiTheme, selected, detail, error, stylesheet, fonts])
}
