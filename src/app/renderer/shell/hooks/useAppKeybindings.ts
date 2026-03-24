import { useEffect, useMemo } from 'react'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import {
  APP_COMMAND_IDS,
  createChordToCommandMap,
  isSupportedKeybindingChord,
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

function isTerminalFindShortcut(event: KeyboardEvent): boolean {
  if (event.altKey) {
    return false
  }

  if (!(event.metaKey || event.ctrlKey)) {
    return false
  }

  return event.key.toLowerCase() === 'f'
}

export function useAppKeybindings({
  enabled,
  settings,
  onToggleCommandCenter,
  onOpenSettings,
  onTogglePrimarySidebar,
  onAddProject,
  onOpenWorkspaceSearch,
}: {
  enabled: boolean
  settings: Pick<AgentSettings, 'disableAppShortcutsWhenTerminalFocused' | 'keybindings'>
  onToggleCommandCenter: () => void
  onOpenSettings: () => void
  onTogglePrimarySidebar: () => void
  onAddProject: () => void
  onOpenWorkspaceSearch: () => void
}): void {
  const platform = useMemo(
    () =>
      typeof window !== 'undefined' && window.opencoveApi?.meta?.platform
        ? window.opencoveApi.meta.platform
        : undefined,
    [],
  )

  const chordToCommand = useMemo(() => {
    return createChordToCommandMap({
      platform,
      overrides: settings.keybindings,
      commandIds: APP_COMMAND_IDS,
    }) as Map<string, AppCommandId>
  }, [platform, settings.keybindings])

  useEffect(() => {
    if (!enabled) {
      return
    }

    const handler = (event: KeyboardEvent): void => {
      if (event.isComposing || event.repeat) {
        return
      }

      if (isTerminalFocusActive(event.target) && isTerminalFindShortcut(event)) {
        return
      }

      const chord = toKeyChord(event)
      if (!isSupportedKeybindingChord(chord)) {
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
        case 'workspace.search':
          onOpenWorkspaceSearch()
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
    onOpenWorkspaceSearch,
    settings.disableAppShortcutsWhenTerminalFocused,
  ])
}
