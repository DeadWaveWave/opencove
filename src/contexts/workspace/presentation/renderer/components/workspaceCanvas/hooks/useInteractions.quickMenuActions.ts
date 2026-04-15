import { useCallback } from 'react'
import type { QuickCommand, QuickPhrase } from '@contexts/settings/domain/agentSettings'
import {
  createNoteNodeAtFlowPosition,
  createTerminalNodeAtFlowPosition,
  createWebsiteNodeAtFlowPosition,
} from './useInteractions.paneNodeCreation'
import type { UseWorkspaceCanvasInteractionsParams } from './useInteractions.types'

export function useWorkspaceCanvasQuickMenuActions(
  options: Pick<
    UseWorkspaceCanvasInteractionsParams,
    | 'contextMenu'
    | 'setContextMenu'
    | 'workspaceId'
    | 'websiteWindowsEnabled'
    | 'standardWindowSizeBucket'
    | 'createWebsiteNode'
    | 'createNoteNode'
    | 'spacesRef'
    | 'nodesRef'
    | 'setNodes'
    | 'onSpacesChange'
    | 'defaultTerminalProfileId'
    | 'workspacePath'
    | 'createNodeForSession'
    | 'onShowMessage'
  >,
): {
  runQuickCommand: (command: QuickCommand) => Promise<void>
  insertQuickPhrase: (phrase: QuickPhrase) => void
} {
  const {
    contextMenu,
    setContextMenu,
    workspaceId,
    websiteWindowsEnabled,
    standardWindowSizeBucket,
    createWebsiteNode,
    createNoteNode,
    spacesRef,
    nodesRef,
    setNodes,
    onSpacesChange,
    defaultTerminalProfileId,
    workspacePath,
    createNodeForSession,
    onShowMessage,
  } = options

  const runQuickCommand = useCallback(
    async (command: QuickCommand): Promise<void> => {
      if (!contextMenu || contextMenu.kind !== 'pane') {
        return
      }

      setContextMenu(null)

      const anchor = { x: contextMenu.flowX, y: contextMenu.flowY }

      if (command.kind === 'url') {
        if (!websiteWindowsEnabled) {
          return
        }

        createWebsiteNodeAtFlowPosition({
          anchor,
          standardWindowSizeBucket,
          url: command.url,
          createWebsiteNode,
          spacesRef,
          nodesRef,
          setNodes,
          onSpacesChange,
        })

        return
      }

      const created = await createTerminalNodeAtFlowPosition({
        anchor,
        workspaceId,
        defaultTerminalProfileId,
        standardWindowSizeBucket,
        workspacePath,
        spacesRef,
        nodesRef,
        setNodes,
        onSpacesChange,
        createNodeForSession,
        onShowMessage,
        title: command.title,
      })

      if (!created) {
        return
      }

      const data = command.command.endsWith('\n') ? command.command : `${command.command}\n`
      await window.opencoveApi.pty.write({
        sessionId: created.sessionId,
        data,
      })
    },
    [
      contextMenu,
      createNodeForSession,
      createWebsiteNode,
      defaultTerminalProfileId,
      nodesRef,
      onSpacesChange,
      onShowMessage,
      setContextMenu,
      setNodes,
      spacesRef,
      standardWindowSizeBucket,
      websiteWindowsEnabled,
      workspacePath,
      workspaceId,
    ],
  )

  const insertQuickPhrase = useCallback(
    (phrase: QuickPhrase): void => {
      if (contextMenu?.kind === 'pane') {
        setContextMenu(null)

        createNoteNodeAtFlowPosition({
          anchor: {
            x: contextMenu.flowX,
            y: contextMenu.flowY,
          },
          standardWindowSizeBucket,
          createNoteNode: (anchor, placementOptions) =>
            createNoteNode(anchor, {
              ...placementOptions,
              initialText: phrase.content,
            }),
          spacesRef,
          nodesRef,
          setNodes,
          onSpacesChange,
        })
        return
      }

      const text = phrase.content
      const writeText = window.opencoveApi?.clipboard?.writeText
      if (typeof writeText === 'function') {
        void writeText(text)
        return
      }

      try {
        const clipboard =
          typeof navigator === 'undefined' ? null : (navigator as Navigator).clipboard
        if (clipboard && typeof clipboard.writeText === 'function') {
          void clipboard.writeText(text)
        }
      } catch {
        // ignore clipboard failures
      }
    },
    [
      contextMenu,
      createNoteNode,
      nodesRef,
      onSpacesChange,
      setContextMenu,
      setNodes,
      spacesRef,
      standardWindowSizeBucket,
    ],
  )

  return { runQuickCommand, insertQuickPhrase }
}
