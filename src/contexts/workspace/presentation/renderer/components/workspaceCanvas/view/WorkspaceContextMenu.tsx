import React from 'react'
import { ArrowRight, Group, ListTodo, Play, Terminal, X } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import type { ContextMenuState } from '../types'

interface WorkspaceContextMenuProps {
  contextMenu: ContextMenuState | null
  closeContextMenu: () => void
  createTerminalNode: () => Promise<void>
  openTaskCreator: () => void
  openAgentLauncher: () => void
  createSpaceFromSelectedNodes: () => void
  clearNodeSelection: () => void
  canConvertSelectedNoteToTask: boolean
  isConvertSelectedNoteToTaskDisabled: boolean
  convertSelectedNoteToTask: () => void
}

export function WorkspaceContextMenu({
  contextMenu,
  closeContextMenu,
  createTerminalNode,
  openTaskCreator,
  openAgentLauncher,
  createSpaceFromSelectedNodes,
  clearNodeSelection,
  canConvertSelectedNoteToTask,
  isConvertSelectedNoteToTaskDisabled,
  convertSelectedNoteToTask,
}: WorkspaceContextMenuProps): React.JSX.Element | null {
  const { t } = useTranslation()

  if (!contextMenu) {
    return null
  }

  return (
    <div
      className="workspace-context-menu"
      style={{ top: contextMenu.y, left: contextMenu.x }}
      onClick={event => {
        event.stopPropagation()
      }}
    >
      {contextMenu.kind === 'pane' ? (
        <>
          <button
            type="button"
            data-testid="workspace-context-new-terminal"
            onClick={() => {
              void createTerminalNode()
            }}
          >
            <Terminal className="workspace-context-menu__icon" aria-hidden="true" />
            <span className="workspace-context-menu__label">
              {t('workspaceContextMenu.newTerminal')}
            </span>
          </button>
          <button
            type="button"
            data-testid="workspace-context-new-task"
            onClick={() => {
              openTaskCreator()
            }}
          >
            <ListTodo className="workspace-context-menu__icon" aria-hidden="true" />
            <span className="workspace-context-menu__label">
              {t('workspaceContextMenu.newTask')}
            </span>
          </button>
          <button
            type="button"
            data-testid="workspace-context-run-default-agent"
            onClick={() => {
              openAgentLauncher()
            }}
          >
            <Play className="workspace-context-menu__icon" aria-hidden="true" />
            <span className="workspace-context-menu__label">
              {t('workspaceContextMenu.runAgent')}
            </span>
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            data-testid="workspace-selection-create-space"
            onClick={() => {
              createSpaceFromSelectedNodes()
            }}
          >
            <Group className="workspace-context-menu__icon" aria-hidden="true" />
            <span className="workspace-context-menu__label">
              {t('workspaceContextMenu.createSpaceWithSelected')}
            </span>
          </button>
          {canConvertSelectedNoteToTask ? (
            <button
              type="button"
              data-testid="workspace-selection-convert-note-to-task"
              disabled={isConvertSelectedNoteToTaskDisabled}
              onClick={() => {
                convertSelectedNoteToTask()
              }}
            >
              <ArrowRight className="workspace-context-menu__icon" aria-hidden="true" />
              <span className="workspace-context-menu__label">
                {t('workspaceContextMenu.convertToTask')}
              </span>
            </button>
          ) : null}
          <button
            type="button"
            data-testid="workspace-selection-clear"
            onClick={() => {
              clearNodeSelection()
              closeContextMenu()
            }}
          >
            <X className="workspace-context-menu__icon" aria-hidden="true" />
            <span className="workspace-context-menu__label">
              {t('workspaceContextMenu.clearSelection')}
            </span>
          </button>
        </>
      )}
    </div>
  )
}
