import { useCallback, useEffect, useRef } from 'react'
import { translate } from '@app/renderer/i18n'
import { toErrorMessage } from '../helpers'
import { resolvePaneNodeCreationAnchor } from './useInteractions.creationAnchor'
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
    | 'browserDefaultMode'
    | 'createWebsiteNode'
    | 'createNoteNode'
    | 'spacesRef'
    | 'nodesRef'
    | 'setNodes'
    | 'onSpacesChange'
    | 'defaultTerminalProfileId'
    | 'terminalFontSize'
    | 'terminalDisplayMetrics'
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
    browserDefaultMode,
    createWebsiteNode,
    createNoteNode,
    spacesRef,
    nodesRef,
    setNodes,
    onSpacesChange,
    defaultTerminalProfileId,
    terminalFontSize,
    terminalDisplayMetrics,
    workspacePath,
    createNodeForSession,
    onShowMessage,
  } = options

  const launchScopeRef = useRef({ active: true })
  useEffect(() => {
    const scope = { active: true }
    launchScopeRef.current = scope
    return () => {
      scope.active = false
    }
  }, [workspaceId])

  const runQuickCommand = useCallback(
    async (command: QuickCommand): Promise<void> => {
      if (!contextMenu || contextMenu.kind !== 'pane') {
        return
      }

      setContextMenu(null)

      const anchor = resolvePaneNodeCreationAnchor(contextMenu)

      if (command.kind === 'url') {
        if (!websiteWindowsEnabled) {
          return
        }

        createWebsiteNodeAtFlowPosition({
          anchor,
          standardWindowSizeBucket,
          browserDefaultMode,
          url: command.url,
          createWebsiteNode,
          spacesRef,
          nodesRef,
          setNodes,
          onSpacesChange,
        })

        return
      }

      if (command.command.trim().length === 0) {
        return
      }

      const launchScope = launchScopeRef.current
      const created = await createTerminalNodeAtFlowPosition({
        anchor,
        workspaceId,
        defaultTerminalProfileId,
        terminalFontSize,
        terminalDisplayMetrics,
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

      if (!created || !launchScope.active) {
        return
      }

      try {
        // Control Surface spawns do not register the session with the Desktop PTY client.
        await window.opencoveApi.pty.attach({ sessionId: created.sessionId })
        if (
          !launchScope.active ||
          !nodesRef.current.some(
            node => node.id === created.nodeId && node.data.sessionId === created.sessionId,
          )
        ) {
          return
        }
        const data = command.command.replace(/\r?\n/g, '\r')
        await window.opencoveApi.pty.write({
          sessionId: created.sessionId,
          data: data.endsWith('\r') ? data : `${data}\r`,
        })
      } catch (error) {
        if (launchScope.active) {
          onShowMessage?.(
            translate('messages.terminalLaunchFailed', { message: toErrorMessage(error) }),
            'error',
          )
        }
      }
    },
    [
      contextMenu,
      createNodeForSession,
      createWebsiteNode,
      defaultTerminalProfileId,
      terminalFontSize,
      terminalDisplayMetrics,
      nodesRef,
      onSpacesChange,
      onShowMessage,
      setContextMenu,
      setNodes,
      spacesRef,
      standardWindowSizeBucket,
      browserDefaultMode,
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
          anchor: resolvePaneNodeCreationAnchor(contextMenu),
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
