import { useMemo } from 'react'
import { formatKeyChord, resolveCommandKeybindings } from '@contexts/settings/domain/keybindings'
import type { KeybindingOverrides } from '@contexts/settings/domain/keybindings'

export function useCommandCenterHints(keybindings: KeybindingOverrides): {
  primaryHint: string
  secondaryHint: string
} {
  const platform =
    typeof window !== 'undefined' && window.opencoveApi?.meta?.platform
      ? window.opencoveApi.meta.platform
      : undefined

  const commandCenterBindings = useMemo(
    () =>
      resolveCommandKeybindings({
        commandId: 'commandCenter.toggle',
        overrides: keybindings,
        platform,
      }),
    [keybindings, platform],
  )

  return {
    primaryHint: formatKeyChord(platform, commandCenterBindings.primary) || '—',
    secondaryHint: formatKeyChord(platform, commandCenterBindings.secondary) || '—',
  }
}
