import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../types'
import { isEditableDomTarget } from './domTargets'
import { focusPrimaryNodeContent } from './focusPrimaryNodeContent'

const ACTIVATION_WAIT_MS = 1000

/** One short-lived focus request per canvas, separate from decoration and terminal autofocus. */
export function createWorkspaceCreationActivation({
  getScope,
  getNodes,
}: {
  getScope: () => HTMLElement | null
  getNodes: () => readonly Node<TerminalNodeData>[]
}) {
  let pending: { id: string; requestedAt: number } | null = null
  let frame: number | null = null
  let focusTimer: number | null = null
  let deadline: number | null = null
  let observer: MutationObserver | null = null
  let disposed = false

  const cancel = () => {
    pending = null
    if (frame !== null) {
      window.cancelAnimationFrame(frame)
    }
    if (focusTimer !== null) {
      window.clearTimeout(focusTimer)
    }
    if (deadline !== null) {
      window.clearTimeout(deadline)
    }
    frame = null
    focusTimer = null
    deadline = null
    observer?.disconnect()
    observer = null
  }
  const modalOpen = () =>
    [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')].some(
      dialog =>
        getComputedStyle(dialog).display !== 'none' &&
        getComputedStyle(dialog).visibility !== 'hidden',
    )
  const attempt = () => {
    focusTimer = null
    if (!pending || disposed) {
      return
    }
    const scope = getScope()
    const node = getNodes().find(candidate => candidate.id === pending?.id)
    if (
      !scope?.isConnected ||
      !node ||
      document.visibilityState === 'hidden' ||
      performance.now() - pending.requestedAt >= ACTIVATION_WAIT_MS
    ) {
      cancel()
      return
    }
    if (modalOpen()) {
      return
    }
    const element = scope.querySelector<HTMLElement>(
      `.react-flow__node[data-id="${CSS.escape(node.id)}"]`,
    )
    if (element && focusPrimaryNodeContent(element, node.data.kind)) {
      cancel()
    }
  }
  const schedule = () => {
    if (!pending || disposed || frame !== null || focusTimer !== null) {
      return
    }
    frame = window.requestAnimationFrame(() => {
      frame = null
      // Run after dialog/popover cleanup's already-queued focus restoration.
      focusTimer = window.setTimeout(attempt, 0)
    })
  }
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      cancel()
    }
  }
  window.addEventListener('pointerdown', cancel, true)
  window.addEventListener('keydown', cancel, true)
  window.addEventListener('blur', cancel)
  document.addEventListener('visibilitychange', onVisibility)

  return {
    request(nodeId: string): void {
      const node = getNodes().find(candidate => candidate.id === nodeId)
      if (disposed || !node) {
        return
      }
      cancel()
      // Preserve the xterm runtime's existing focus/handoff ownership.
      if (
        node.data.kind === 'terminal' ||
        node.data.kind === 'agent' ||
        document.visibilityState === 'hidden' ||
        !getScope()?.isConnected
      ) {
        return
      }
      // Image decoding/storage can finish after the user has resumed another editor.
      const focusedNode = document.activeElement?.closest('.react-flow__node')
      if (
        node.data.kind === 'image' &&
        isEditableDomTarget(document.activeElement) &&
        focusedNode &&
        focusedNode.getAttribute('data-id') !== nodeId &&
        getScope()?.contains(focusedNode)
      ) {
        return
      }
      pending = { id: nodeId, requestedAt: performance.now() }
      observer = new MutationObserver(schedule)
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-testid', 'inert', 'aria-hidden', 'disabled'],
      })
      deadline = window.setTimeout(cancel, ACTIVATION_WAIT_MS)
      schedule()
    },
    dispose(): void {
      disposed = true
      cancel()
      window.removeEventListener('pointerdown', cancel, true)
      window.removeEventListener('keydown', cancel, true)
      window.removeEventListener('blur', cancel)
      document.removeEventListener('visibilitychange', onVisibility)
    },
  }
}
