import { useSyncExternalStore } from 'react'
import type { PluginThemeFont } from '../../domain/pluginThemeResources'

export interface ThemeApplicationStatus {
  requestedId: string
  appliedId: string
  loading: boolean
  error: string | null
}
const listeners = new Set<() => void>()
let status: ThemeApplicationStatus = {
  requestedId: 'pixel',
  appliedId: 'pixel',
  loading: false,
  error: null,
}
let fonts: readonly PluginThemeFont[] = []

export function publishThemeApplication(
  next: ThemeApplicationStatus,
  nextFonts: readonly PluginThemeFont[] = [],
): void {
  fonts = nextFonts
  if (JSON.stringify(status) === JSON.stringify(next)) {
    return
  }
  status = next
  listeners.forEach(listener => listener())
}
export function readAppliedThemeFonts(): readonly PluginThemeFont[] {
  return fonts
}
export function useThemeApplicationStatus(): ThemeApplicationStatus {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => status,
    () => status,
  )
}
