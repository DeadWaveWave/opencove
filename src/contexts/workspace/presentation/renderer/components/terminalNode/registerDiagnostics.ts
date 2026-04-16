import type { TerminalWindowsPty, TerminalDiagnosticsLogInput } from '@shared/contracts/dto'
import type { Terminal } from '@xterm/xterm'
import type { TerminalThemeMode } from './theme'
import {
  captureTerminalDiagnosticsSnapshot,
  captureTerminalInteractionDetails,
  createTerminalDiagnosticsLogger,
} from './diagnostics'

export function registerTerminalDiagnostics({
  enabled,
  emit,
  nodeId,
  sessionId,
  nodeKind,
  title,
  terminal,
  container,
  rendererKind,
  terminalThemeMode,
  windowsPty,
}: {
  enabled: boolean
  emit: (payload: TerminalDiagnosticsLogInput) => void
  nodeId: string
  sessionId: string
  nodeKind: 'terminal' | 'agent'
  title: string
  terminal: Terminal
  container: HTMLDivElement | null
  rendererKind: 'webgl' | 'dom'
  terminalThemeMode: TerminalThemeMode
  windowsPty: TerminalWindowsPty | null
}): {
  log: (event: string, details?: TerminalDiagnosticsLogInput['details']) => void
  logHydrated: (details: { rawSnapshotLength: number; bufferedExitCode: number | null }) => void
  dispose: () => void
} {
  const viewportElement =
    container?.querySelector('.xterm-viewport') instanceof HTMLElement
      ? (container.querySelector('.xterm-viewport') as HTMLElement)
      : null
  const diagnostics = createTerminalDiagnosticsLogger({
    enabled,
    emit,
    base: {
      source: 'renderer-terminal',
      nodeId,
      sessionId,
      nodeKind,
      title,
    },
  })

  const collectInteractionDetails = (point?: { x: number; y: number } | null) =>
    captureTerminalInteractionDetails({
      container,
      rendererKind,
      point,
    })

  diagnostics.log('init', captureTerminalDiagnosticsSnapshot(terminal, viewportElement), {
    windowsPtyBackend: windowsPty?.backend ?? null,
    windowsPtyBuild: windowsPty?.buildNumber ?? null,
    terminalThemeMode,
    ...collectInteractionDetails(),
  })

  const resizeDisposable =
    typeof (terminal as unknown as { onResize?: unknown }).onResize === 'function'
      ? (
          terminal as unknown as {
            onResize: (listener: (size: { cols: number; rows: number }) => void) => {
              dispose: () => void
            }
          }
        ).onResize(size => {
          diagnostics.log('resize', captureTerminalDiagnosticsSnapshot(terminal, viewportElement), {
            cols: size.cols,
            rows: size.rows,
          })
        })
      : { dispose: () => undefined }

  const handleViewportWheel = (event: WheelEvent): void => {
    diagnostics.log('wheel', captureTerminalDiagnosticsSnapshot(terminal, viewportElement), {
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
    })
  }

  const handleViewportScroll = (): void => {
    diagnostics.log('scroll', captureTerminalDiagnosticsSnapshot(terminal, viewportElement))
  }

  const xtermElement =
    container?.querySelector('.xterm') instanceof HTMLElement
      ? (container.querySelector('.xterm') as HTMLElement)
      : null
  const reactFlowNode =
    container?.closest('.react-flow__node') instanceof HTMLElement
      ? (container.closest('.react-flow__node') as HTMLElement)
      : null
  const workspaceCanvas =
    container?.closest('.workspace-canvas') instanceof HTMLElement
      ? (container.closest('.workspace-canvas') as HTMLElement)
      : null

  const logInteractionEvent = (event: string, point?: { x: number; y: number } | null): void => {
    diagnostics.log(event, captureTerminalDiagnosticsSnapshot(terminal, viewportElement), {
      ...collectInteractionDetails(point),
    })
  }

  const logInteractionEventWithDetails = (
    event: string,
    details: TerminalDiagnosticsLogInput['details'],
    point?: { x: number; y: number } | null,
  ): void => {
    diagnostics.log(event, captureTerminalDiagnosticsSnapshot(terminal, viewportElement), {
      ...collectInteractionDetails(point),
      ...details,
    })
  }

  const mutationObserver =
    enabled && typeof MutationObserver !== 'undefined'
      ? new MutationObserver(mutations => {
          for (const mutation of mutations) {
            if (
              mutation.type !== 'attributes' ||
              (mutation.attributeName !== 'class' &&
                mutation.attributeName !== 'data-cove-drag-surface-selection-mode')
            ) {
              continue
            }

            const event =
              mutation.target === xtermElement
                ? 'xterm-class-change'
                : mutation.target === reactFlowNode
                  ? 'react-flow-node-class-change'
                  : 'workspace-canvas-drag-surface-change'

            if (
              mutation.attributeName === 'class' &&
              mutation.target instanceof HTMLElement &&
              typeof mutation.oldValue === 'string'
            ) {
              const nextClassName = mutation.target.className
              if (nextClassName === mutation.oldValue) {
                continue
              }

              logInteractionEventWithDetails(event, {
                mutationOldClassName: mutation.oldValue,
                mutationNewClassName: nextClassName,
              })
              continue
            }

            logInteractionEvent(event)
          }
        })
      : null

  if (mutationObserver) {
    if (xtermElement) {
      mutationObserver.observe(xtermElement, {
        attributes: true,
        attributeFilter: ['class'],
        attributeOldValue: true,
      })
    }

    if (reactFlowNode) {
      mutationObserver.observe(reactFlowNode, {
        attributes: true,
        attributeFilter: ['class'],
        attributeOldValue: true,
      })
    }

    if (workspaceCanvas) {
      mutationObserver.observe(workspaceCanvas, {
        attributes: true,
        attributeFilter: ['data-cove-drag-surface-selection-mode'],
      })
    }
  }

  let pointerInsideTerminal = false
  let lastPointerPoint: { x: number; y: number } | null = null
  let lastPointerSignature: string | null = null
  const pointerPollTimer =
    enabled && typeof window !== 'undefined'
      ? window.setInterval(() => {
          if (!pointerInsideTerminal || !lastPointerPoint) {
            return
          }

          const details = collectInteractionDetails(lastPointerPoint)
          const signature = JSON.stringify(details)
          if (signature === lastPointerSignature) {
            return
          }

          lastPointerSignature = signature
          diagnostics.log(
            'hover-hit-target-change',
            captureTerminalDiagnosticsSnapshot(terminal, viewportElement),
            details,
          )
        }, 120)
      : null

  let lastRingSignature: string | null = null
  const ringPollTimer =
    enabled && typeof window !== 'undefined'
      ? window.setInterval(() => {
          const details = collectInteractionDetails()
          const ringDetails = {
            activeElement: details['activeElement'] ?? null,
            activeElementInsideTerminalNode: details['activeElementInsideTerminalNode'] ?? null,
            terminalNodeFocusWithin: details['terminalNodeFocusWithin'] ?? null,
            terminalNodeBorderColor: details['terminalNodeBorderColor'] ?? null,
            reactFlowNodeSelected: details['reactFlowNodeSelected'] ?? null,
            selectedSurfaceActive: details['selectedSurfaceActive'] ?? null,
            xtermClassName: details['xtermClassName'] ?? null,
          }
          const signature = JSON.stringify(ringDetails)
          if (signature === lastRingSignature) {
            return
          }

          lastRingSignature = signature
          diagnostics.log(
            'ring-state-change',
            captureTerminalDiagnosticsSnapshot(terminal, viewportElement),
            ringDetails,
          )
        }, 120)
      : null

  const updatePointerPoint = (event: PointerEvent): void => {
    pointerInsideTerminal = true
    lastPointerPoint = {
      x: event.clientX,
      y: event.clientY,
    }
  }

  const handlePointerEnter = (event: PointerEvent): void => {
    updatePointerPoint(event)
    lastPointerSignature = null
    logInteractionEvent('pointer-enter', lastPointerPoint)
  }

  const handlePointerDown = (event: PointerEvent): void => {
    updatePointerPoint(event)
    lastPointerSignature = null
    logInteractionEvent('pointer-down', lastPointerPoint)
  }

  const handlePointerMove = (event: PointerEvent): void => {
    updatePointerPoint(event)
  }

  const handlePointerLeave = (): void => {
    pointerInsideTerminal = false
    lastPointerPoint = null
    lastPointerSignature = null
  }

  const handleFocusIn = (): void => {
    logInteractionEvent('focus-in')
  }

  const handleFocusOut = (): void => {
    logInteractionEvent('focus-out')
  }

  viewportElement?.addEventListener('wheel', handleViewportWheel, { passive: true })
  viewportElement?.addEventListener('scroll', handleViewportScroll, { passive: true })
  container?.addEventListener('pointerdown', handlePointerDown, { passive: true })
  container?.addEventListener('pointerenter', handlePointerEnter, { passive: true })
  container?.addEventListener('pointermove', handlePointerMove, { passive: true })
  container?.addEventListener('pointerleave', handlePointerLeave, { passive: true })
  container?.addEventListener('focusin', handleFocusIn)
  container?.addEventListener('focusout', handleFocusOut)

  return {
    log: (event, details) => {
      diagnostics.log(event, captureTerminalDiagnosticsSnapshot(terminal, viewportElement), {
        ...collectInteractionDetails(),
        ...(details ? details : {}),
      })
    },
    logHydrated: ({ rawSnapshotLength, bufferedExitCode }) => {
      diagnostics.log('hydrated', captureTerminalDiagnosticsSnapshot(terminal, viewportElement), {
        rawSnapshotLength,
        bufferedExitCode,
      })
    },
    dispose: () => {
      resizeDisposable.dispose()
      mutationObserver?.disconnect()
      if (pointerPollTimer !== null) {
        window.clearInterval(pointerPollTimer)
      }
      if (ringPollTimer !== null) {
        window.clearInterval(ringPollTimer)
      }
      viewportElement?.removeEventListener('wheel', handleViewportWheel)
      viewportElement?.removeEventListener('scroll', handleViewportScroll)
      container?.removeEventListener('pointerdown', handlePointerDown)
      container?.removeEventListener('pointerenter', handlePointerEnter)
      container?.removeEventListener('pointermove', handlePointerMove)
      container?.removeEventListener('pointerleave', handlePointerLeave)
      container?.removeEventListener('focusin', handleFocusIn)
      container?.removeEventListener('focusout', handleFocusOut)
    },
  }
}
