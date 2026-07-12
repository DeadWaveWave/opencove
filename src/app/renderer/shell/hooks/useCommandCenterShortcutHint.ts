import { useMemo } from 'react'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import { formatKeyChord, resolveCommandKeybinding } from '@contexts/settings/domain/keybindings'

export function useCommandCenterShortcutHint(keybindings: AgentSettings['keybindings']): string {
  const platform =
    typeof window !== 'undefined' && window.opencoveApi?.meta?.platform
      ? window.opencoveApi.meta.platform
      : undefined

  const bindings = useMemo(
    () =>
      resolveCommandKeybinding({
        commandId: 'commandCenter.toggle',
        overrides: keybindings,
        platform,
      }),
    [keybindings, platform],
  )

  return formatKeyChord(platform, bindings) || '—'
}
