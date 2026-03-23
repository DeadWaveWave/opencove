import { useEffect, useMemo } from 'react'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import {
  APP_COMMAND_IDS,
  hasNonShiftModifier,
  resolveEffectiveKeybindings,
  serializeKeyChord,
  toKeyChord,
  type AppCommandId,
} from '@contexts/settings/domain/keybindings'

const TERMINAL_FOCUS_SCOPE_SELECTOR = '[data-cove-focus-scope="terminal"]'

function isTerminalFocusActive(target: EventTarget | null): boolean {
  if (target instanceof Element && target.closest(TERMINAL_FOCUS_SCOPE_SELECTOR)) {
    return true
  }

  const activeElement = document.activeElement instanceof Element ? document.activeElement : null
  return !!activeElement?.closest(TERMINAL_FOCUS_SCOPE_SELECTOR)
}

function isSupportedChord(
  chord: ReturnType<typeof toKeyChord>,
): chord is NonNullable<ReturnType<typeof toKeyChord>> {
  if (!chord) {
    return false
  }

  if (hasNonShiftModifier(chord)) {
    return true
  }

  return /^F\d+$/.test(chord.code)
}

export function useAppKeybindings({
  enabled,
  settings,
  onToggleCommandCenter,
  onOpenSettings,
  onTogglePrimarySidebar,
  onAddProject,
}: {
  enabled: boolean
  settings: Pick<AgentSettings, 'disableAppShortcutsWhenTerminalFocused' | 'keybindings'>
  onToggleCommandCenter: () => void
  onOpenSettings: () => void
  onTogglePrimarySidebar: () => void
  onAddProject: () => void
}): void {
  const platform = useMemo(
    () =>
      typeof window !== 'undefined' && window.opencoveApi?.meta?.platform
        ? window.opencoveApi.meta.platform
        : undefined,
    [],
  )

  const chordToCommand = useMemo(() => {
    const bindings = resolveEffectiveKeybindings({ platform, overrides: settings.keybindings })
    const map = new Map<string, AppCommandId>()

    for (const commandId of APP_COMMAND_IDS) {
      const commandBindings = bindings[commandId]
      const primary = commandBindings.primary
      if (primary) {
        const serialized = serializeKeyChord(primary)
        if (!map.has(serialized)) {
          map.set(serialized, commandId)
        }
      }
      const secondary = commandBindings.secondary
      if (secondary) {
        const serialized = serializeKeyChord(secondary)
        if (!map.has(serialized)) {
          map.set(serialized, commandId)
        }
      }
    }

    return map
  }, [platform, settings.keybindings])

  useEffect(() => {
    if (!enabled) {
      return
    }

    const handler = (event: KeyboardEvent): void => {
      if (event.isComposing || event.repeat) {
        return
      }

      const chord = toKeyChord(event)
      if (!isSupportedChord(chord)) {
        return
      }

      if (settings.disableAppShortcutsWhenTerminalFocused && isTerminalFocusActive(event.target)) {
        return
      }

      const commandId = chordToCommand.get(serializeKeyChord(chord))
      if (!commandId) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      switch (commandId) {
        case 'commandCenter.toggle':
          onToggleCommandCenter()
          return
        case 'app.openSettings':
          onOpenSettings()
          return
        case 'app.togglePrimarySidebar':
          onTogglePrimarySidebar()
          return
        case 'workspace.addProject':
          onAddProject()
          return
        default: {
          const _exhaustive: never = commandId
          return _exhaustive
        }
      }
    }

    document.addEventListener('keydown', handler, { capture: true })
    return () => {
      document.removeEventListener('keydown', handler, { capture: true })
    }
  }, [
    chordToCommand,
    enabled,
    onAddProject,
    onOpenSettings,
    onToggleCommandCenter,
    onTogglePrimarySidebar,
    settings.disableAppShortcutsWhenTerminalFocused,
  ])
}
