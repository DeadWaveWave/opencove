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
const DOCUMENT_EDITOR_FOCUS_SCOPE_SELECTOR = '[data-cove-focus-scope="document-editor"]'
const EDITABLE_TARGET_SELECTOR = 'input, textarea, select, [contenteditable="true"]'

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (target instanceof HTMLElement) {
    if (target.isContentEditable || target.closest(EDITABLE_TARGET_SELECTOR)) {
      return true
    }

    const { tagName } = target
    if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
      return true
    }
  }

  const activeElement =
    document.activeElement instanceof HTMLElement ? document.activeElement : null
  return Boolean(
    activeElement?.isContentEditable || activeElement?.closest(EDITABLE_TARGET_SELECTOR),
  )
}

function resolveWorkspaceShortcutIndex(event: KeyboardEvent): number | null {
  if (event.altKey || event.shiftKey || (event.metaKey && event.ctrlKey)) {
    return null
  }

  if (!event.metaKey && !event.ctrlKey) {
    return null
  }

  const match = /^(?:Digit|Numpad)([1-9])$/.exec(event.code)
  if (match) {
    return Number(match[1]) - 1
  }

  return /^[1-9]$/.test(event.key) ? Number(event.key) - 1 : null
}

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

function isDocumentEditorFocusActive(target: EventTarget | null): boolean {
  if (target instanceof Element && target.closest(DOCUMENT_EDITOR_FOCUS_SCOPE_SELECTOR)) {
    return true
  }

  const activeElement = document.activeElement instanceof Element ? document.activeElement : null
  return !!activeElement?.closest(DOCUMENT_EDITOR_FOCUS_SCOPE_SELECTOR)
}

export function useAppKeybindings({
  enabled,
  settings,
  onToggleCommandCenter,
  onOpenSettings,
  onTogglePrimarySidebar,
  onAddProject,
  onOpenWorkspaceSearch,
  workspaceIds,
  onSelectWorkspace,
}: {
  enabled: boolean
  settings: Pick<AgentSettings, 'disableAppShortcutsWhenTerminalFocused' | 'keybindings'>
  onToggleCommandCenter: () => void
  onOpenSettings: () => void
  onTogglePrimarySidebar: () => void
  onAddProject: () => void
  onOpenWorkspaceSearch: () => void
  workspaceIds: readonly string[]
  onSelectWorkspace: (workspaceId: string) => void
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
      if (event.isComposing || event.repeat || event.defaultPrevented) {
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

      const workspaceShortcutIndex = resolveWorkspaceShortcutIndex(event)
      if (
        workspaceShortcutIndex !== null &&
        !isEditableKeyboardTarget(event.target) &&
        workspaceShortcutIndex < workspaceIds.length
      ) {
        event.preventDefault()
        event.stopPropagation()
        onSelectWorkspace(workspaceIds[workspaceShortcutIndex])
        return
      }

      const commandId = chordToCommand.get(serializeKeyChord(chord))
      if (!commandId) {
        return
      }

      if (commandId === 'workspace.search' && isDocumentEditorFocusActive(event.target)) {
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
    onSelectWorkspace,
    settings.disableAppShortcutsWhenTerminalFocused,
    workspaceIds,
  ])
}
