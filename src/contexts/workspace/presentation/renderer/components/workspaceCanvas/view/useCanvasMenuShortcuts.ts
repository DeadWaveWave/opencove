import { useMemo } from 'react'
import {
  describeKeyChord,
  resolveCommandKeybinding,
  type KeybindingOverrides,
  type KeyChordDescription,
  type WorkspaceCanvasCommandId,
} from '@contexts/settings/domain/keybindings'

export type CanvasMenuShortcuts = {
  createTerminal: KeyChordDescription | null
  createNote: KeyChordDescription | null
  createAgent: KeyChordDescription | null
  createSpace: KeyChordDescription | null
}

/**
 * The chords the canvas shortcut handler runs for the commands the context menu also offers,
 * resolved through the same overrides so a menu never shows a stale or unassigned shortcut.
 */
export function useCanvasMenuShortcuts(keybindings: KeybindingOverrides): CanvasMenuShortcuts {
  const platform =
    typeof window !== 'undefined' && window.opencoveApi?.meta?.platform
      ? window.opencoveApi.meta.platform
      : undefined

  return useMemo(() => {
    const describe = (commandId: WorkspaceCanvasCommandId): KeyChordDescription | null =>
      describeKeyChord(
        platform,
        resolveCommandKeybinding({ commandId, overrides: keybindings, platform }),
      )

    return {
      createTerminal: describe('workspaceCanvas.createTerminal'),
      createNote: describe('workspaceCanvas.createNote'),
      createAgent: describe('workspaceCanvas.createAgent'),
      createSpace: describe('workspaceCanvas.createSpace'),
    }
  }, [keybindings, platform])
}
