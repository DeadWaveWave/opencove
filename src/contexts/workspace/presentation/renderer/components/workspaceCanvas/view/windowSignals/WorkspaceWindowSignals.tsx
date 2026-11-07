import { useEffect, useRef, type RefObject } from 'react'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../../../types'
import { resolveAgentPresentation } from '../../../../utils/agentPresentation'
import { resolveWindowKindFamily } from '../../../../utils/windowKindFamily'
import { readWallLightPalette } from '../pixelWall/wallPalette'
import { clearWindowSignals, showWindowSignal } from './frameSignals'
import { getPtyEventHub } from '@app/renderer/shell/utils/ptyEventHub'
import { createRuntimeCompletionDetector, createWindowSignalDetector } from './signalDetector'
import { publishWindowSignal } from './windowSignalEvents'

/** How long a finished run's frame flash and a failure's glitch stay on the frame. */
const COMPLETE_MS = 1200
const FAIL_MS = 900

/**
 * The one owner of completion and failure signals (Tide 5.4d): it watches agent state, flashes
 * the window's frame and announces the moment so the wall can send its wave. It renders nothing.
 * Transitions are observed even while the effect is off, so turning it on never replays one.
 */
export function WorkspaceWindowSignals({
  nodes,
  canvasRef,
  enabled,
}: {
  nodes: Node<TerminalNodeData>[]
  canvasRef: RefObject<HTMLDivElement | null>
  enabled: boolean
}): null {
  const detectorRef = useRef(createWindowSignalDetector())
  const runtimeSessions = useRef(new Set<string>())
  const current = useRef({ nodes, enabled })
  current.current = { nodes, enabled }

  useEffect(() => {
    const completed = createRuntimeCompletionDetector()
    return getPtyEventHub().onState(event => {
      const snapshot = event.agentRunState
      if (!snapshot) {
        return
      }
      runtimeSessions.current.add(event.sessionId)
      const didComplete = completed(snapshot)
      const scope = canvasRef.current
      if (!didComplete || !current.current.enabled || !scope) {
        return
      }
      const node = current.current.nodes.find(
        candidate => candidate.data.sessionId === event.sessionId,
      )
      if (!node || !resolveAgentPresentation(node.data).isAgent) {
        return
      }
      const lights = readWallLightPalette(scope)
      showWindowSignal(
        scope,
        node.id,
        'complete',
        lights[resolveWindowKindFamily(node.data)],
        COMPLETE_MS,
      )
      publishWindowSignal({ kind: 'complete', nodeId: node.id })
    })
  }, [canvasRef])

  useEffect(() => {
    const signals = detectorRef.current.observe(
      nodes.map(node => {
        const presentation = resolveAgentPresentation(node.data)
        return { id: node.id, isAgent: presentation.isAgent, status: presentation.status }
      }),
      performance.now(),
    )
    const scope = canvasRef.current
    if (!enabled && scope) {
      clearWindowSignals(scope)
    }
    if (!enabled || !scope || signals.length === 0) {
      return
    }
    const lights = readWallLightPalette(scope)
    for (const signal of signals) {
      const node = nodes.find(candidate => candidate.id === signal.id)
      if (
        !node ||
        (signal.kind === 'complete' && runtimeSessions.current.has(node.data.sessionId ?? ''))
      ) {
        continue
      }
      const color =
        signal.kind === 'fail' ? lights.failed : lights[resolveWindowKindFamily(node.data)]
      showWindowSignal(
        scope,
        signal.id,
        signal.kind,
        color,
        signal.kind === 'fail' ? FAIL_MS : COMPLETE_MS,
      )
      publishWindowSignal({ kind: signal.kind, nodeId: signal.id })
    }
  }, [nodes, enabled, canvasRef])

  useEffect(() => {
    const scope = canvasRef.current
    return () => {
      if (scope) {
        clearWindowSignals(scope)
      }
    }
  }, [canvasRef])

  return null
}
