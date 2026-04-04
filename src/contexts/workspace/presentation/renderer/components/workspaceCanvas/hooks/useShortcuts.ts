import { useEffect, useMemo } from 'react'
import type { Node } from '@xyflow/react'
import type {
  KeybindingOverrides,
  WorkspaceCanvasCommandId,
} from '@contexts/settings/domain/keybindings'
import {
  WORKSPACE_CANVAS_COMMAND_IDS,
  createChordToCommandMap,
  isSupportedKeybindingChord,
  serializeKeyChord,
  toKeyChord,
} from '@contexts/settings/domain/keybindings'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { resolveCycledSpaceId, resolveIdleSpaceIds } from './useShortcuts.helpers'

const TERMINAL_FOCUS_SCOPE_SELECTOR = '[data-cove-focus-scope="terminal"]'

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  if (target.isContentEditable || target.closest('[contenteditable="true"]')) {
    return true
  }

  const { tagName } = target
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT'
}

function isTerminalFocusActive(target: EventTarget | null): boolean {
  if (target instanceof Element) {
    return !!target.closest(TERMINAL_FOCUS_SCOPE_SELECTOR)
  }

  const activeElement = document.activeElement instanceof Element ? document.activeElement : null
  return !!activeElement?.closest(TERMINAL_FOCUS_SCOPE_SELECTOR)
}

export function useWorkspaceCanvasShortcuts({
  enabled,
  platform,
  keybindings,
  disableWhenTerminalFocused,
  activeSpaceId,
  spaces,
  nodesRef,
  createSpaceFromSelectedNodes,
  createNoteAtViewportCenter,
  createTerminalAtViewportCenter,
  activateSpace,
}: {
  enabled: boolean
  platform: string | undefined
  keybindings: KeybindingOverrides
  disableWhenTerminalFocused: boolean
  activeSpaceId: string | null
  spaces: WorkspaceSpaceState[]
  nodesRef: React.MutableRefObject<Array<Node<TerminalNodeData>>>
  createSpaceFromSelectedNodes: () => void
  createNoteAtViewportCenter: () => void
  createTerminalAtViewportCenter: () => Promise<void>
  activateSpace: (spaceId: string) => void
}): void {
  const spaceIds = useMemo(() => spaces.map(space => space.id), [spaces])
  const chordToCommand = useMemo(
    () =>
      createChordToCommandMap({
        platform,
        overrides: keybindings,
        commandIds: WORKSPACE_CANVAS_COMMAND_IDS,
      }) as Map<string, WorkspaceCanvasCommandId>,
    [keybindings, platform],
  )

  useEffect(() => {
    if (!enabled) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.isComposing || event.repeat || isEditableKeyboardTarget(event.target)) {
        return
      }

      if (disableWhenTerminalFocused && isTerminalFocusActive(event.target)) {
        return
      }

      const chord = toKeyChord(event)
      if (!isSupportedKeybindingChord(chord)) {
        return
      }

      const commandId = chordToCommand.get(serializeKeyChord(chord))
      if (!commandId) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      switch (commandId) {
        case 'workspaceCanvas.createSpace':
          createSpaceFromSelectedNodes()
          return
        case 'workspaceCanvas.createNote':
          createNoteAtViewportCenter()
          return
        case 'workspaceCanvas.createTerminal':
          void createTerminalAtViewportCenter()
          return
        case 'workspaceCanvas.cycleSpacesForward':
        case 'workspaceCanvas.cycleSpacesBackward':
        case 'workspaceCanvas.cycleIdleSpacesForward':
        case 'workspaceCanvas.cycleIdleSpacesBackward': {
          const nextSpaceId = resolveCycledSpaceId({
            direction:
              commandId === 'workspaceCanvas.cycleSpacesForward' ||
              commandId === 'workspaceCanvas.cycleIdleSpacesForward'
                ? 'next'
                : 'previous',
            activeSpaceId,
            spaceIds:
              commandId === 'workspaceCanvas.cycleIdleSpacesForward' ||
              commandId === 'workspaceCanvas.cycleIdleSpacesBackward'
                ? resolveIdleSpaceIds({ spaces, nodes: nodesRef.current })
                : spaceIds,
          })

          if (!nextSpaceId) {
            return
          }

          activateSpace(nextSpaceId)
          return
        }
        default: {
          const _exhaustive: never = commandId
          return _exhaustive
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true })
    }
  }, [
    activeSpaceId,
    activateSpace,
    createNoteAtViewportCenter,
    createSpaceFromSelectedNodes,
    createTerminalAtViewportCenter,
    disableWhenTerminalFocused,
    enabled,
    keybindings,
    nodesRef,
    chordToCommand,
    spaceIds,
    spaces,
  ])
}
