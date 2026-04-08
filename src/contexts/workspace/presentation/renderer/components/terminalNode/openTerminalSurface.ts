import type { MutableRefObject } from 'react'
import type { Terminal } from '@xterm/xterm'
import { patchXtermMouseServiceWithRetry } from './patchXtermMouseService'
import { registerTerminalHitTargetCursorScope } from './hitTargetCursorScope'
import { registerTerminalSelectionTestHandle } from './testHarness'
import type { WindowsAutomationPasteGuard } from './windowsAutomationPasteGuard'

export function openTerminalSurface({
  activeRenderer,
  activeRendererKindRef,
  container,
  nodeId,
  resolvedTerminalUiTheme,
  scheduleTranscriptSync,
  scheduleWebglPixelSnapping,
  sessionId,
  syncTerminalSize,
  terminal,
  windowsAutomationPasteGuard,
  isTestEnvironment,
}: {
  activeRenderer: { clearTextureAtlas: () => void }
  activeRendererKindRef: MutableRefObject<'webgl' | 'dom'>
  container: HTMLDivElement
  nodeId: string
  resolvedTerminalUiTheme: string
  scheduleTranscriptSync: () => void
  scheduleWebglPixelSnapping: () => void
  sessionId: string
  syncTerminalSize: () => void
  terminal: Terminal
  windowsAutomationPasteGuard: WindowsAutomationPasteGuard | null
  isTestEnvironment: boolean
}): {
  cancelMouseServicePatch: () => void
  disposeContainerRuntime: () => void
  disposePositionObserver: () => void
  disposeTerminalHitTargetCursorScope: () => void
  disposeTerminalSelectionTestHandle: () => void
} {
  let disposeTerminalSelectionTestHandle: () => void = () => undefined
  let disposePositionObserver: () => void = () => undefined

  const handleTerminalPointerDown = (): void => {
    windowsAutomationPasteGuard?.noteManualPointerInteraction()
  }

  const xtermSelectionObserver =
    windowsAutomationPasteGuard && typeof MutationObserver !== 'undefined'
      ? new MutationObserver(() => {
          const xtermElement =
            container.querySelector('.xterm') instanceof HTMLElement
              ? (container.querySelector('.xterm') as HTMLElement)
              : null

          windowsAutomationPasteGuard.noteColumnSelectionMode(
            xtermElement?.classList.contains('column-select') ?? false,
            () => terminal.clearSelection(),
          )
        })
      : null

  terminal.open(container)
  container.setAttribute('data-cove-terminal-theme', resolvedTerminalUiTheme)
  container.addEventListener('pointerdown', handleTerminalPointerDown, {
    passive: true,
  })

  const xtermElement =
    container.querySelector('.xterm') instanceof HTMLElement
      ? (container.querySelector('.xterm') as HTMLElement)
      : null
  if (xtermSelectionObserver && xtermElement) {
    xtermSelectionObserver.observe(xtermElement, {
      attributes: true,
      attributeFilter: ['class'],
    })
  }

  const cancelMouseServicePatch = patchXtermMouseServiceWithRetry(terminal)
  const disposeTerminalHitTargetCursorScope = registerTerminalHitTargetCursorScope({
    container,
    ownerId: `${nodeId}:${sessionId}`,
  })

  const reactFlowViewport =
    container.closest('.react-flow__viewport') instanceof HTMLElement
      ? (container.closest('.react-flow__viewport') as HTMLElement)
      : null
  const reactFlowNode =
    container.closest('.react-flow__node') instanceof HTMLElement
      ? (container.closest('.react-flow__node') as HTMLElement)
      : null

  if (typeof MutationObserver !== 'undefined' && (reactFlowViewport || reactFlowNode)) {
    const observer = new MutationObserver(() => {
      if (activeRendererKindRef.current !== 'webgl') {
        return
      }

      scheduleWebglPixelSnapping()
    })

    if (reactFlowViewport) {
      observer.observe(reactFlowViewport, {
        attributes: true,
        attributeFilter: ['style', 'class'],
      })
    }

    if (reactFlowNode) {
      observer.observe(reactFlowNode, {
        attributes: true,
        attributeFilter: ['style', 'class'],
      })
    }

    disposePositionObserver = () => observer.disconnect()
  }

  if (isTestEnvironment) {
    disposeTerminalSelectionTestHandle = registerTerminalSelectionTestHandle(nodeId, terminal)
  }

  activeRenderer.clearTextureAtlas()
  syncTerminalSize()
  requestAnimationFrame(syncTerminalSize)
  if (isTestEnvironment) {
    terminal.focus()
    scheduleTranscriptSync()
  }

  return {
    cancelMouseServicePatch,
    disposeContainerRuntime: () => {
      container.removeEventListener('pointerdown', handleTerminalPointerDown)
      xtermSelectionObserver?.disconnect()
    },
    disposePositionObserver,
    disposeTerminalHitTargetCursorScope,
    disposeTerminalSelectionTestHandle,
  }
}
