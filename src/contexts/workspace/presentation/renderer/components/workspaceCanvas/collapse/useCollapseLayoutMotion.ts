import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { canAnimateCollapse, createCollapseAnimationGroup } from './collapseMotion'
import { readThemeTransition } from '@contexts/plugins/presentation/renderer/themeMotion'

type MotionKind = 'arrange' | 'expand' | 'restore'

/** FLIP positions on DOM chrome only. React Flow always owns final hit geometry. */
export function useCollapseLayoutMotion(
  workspaceId: string,
  canvasRef?: RefObject<HTMLElement | null>,
) {
  const active = useRef<ReturnType<typeof createCollapseAnimationGroup> | null>(null)
  const stagger = useRef(new Map<string, number>())
  const staggerUntil = useRef(0)
  const cancel = useCallback(() => {
    active.current?.dispose()
    active.current = null
    stagger.current.clear()
  }, [])
  useEffect(() => {
    const canvas = canvasRef?.current
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const cancelDrag = (event: PointerEvent) => {
      if (event.buttons !== 0) {
        cancel()
      }
    }
    canvas?.addEventListener('pointermove', cancelDrag, true)
    media?.addEventListener('change', cancel)
    return () => {
      canvas?.removeEventListener('pointermove', cancelDrag, true)
      media?.removeEventListener('change', cancel)
      cancel()
    }
  }, [canvasRef, cancel, workspaceId])

  const prepare = useCallback(
    (kind: MotionKind, nodes: Node<TerminalNodeData>[], spaces: WorkspaceSpaceState[]) => {
      const canvas = canvasRef?.current
      if (!canvas || !canAnimateCollapse(kind === 'arrange' ? 'fold' : 'unfold')) {
        return
      }
      // Read all current positions before cancelling an interrupted transition.
      const nodeFrames = nodes.flatMap(node => {
        const element = canvas.querySelector<HTMLElement>(
          `.react-flow__node[data-id="${CSS.escape(node.id)}"]`,
        )
        if (!element) {
          return []
        }
        const transform = getComputedStyle(element).transform
        const matrix =
          transform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(transform)
        if (
          Math.abs(matrix.e - node.position.x) < 0.1 &&
          Math.abs(matrix.f - node.position.y) < 0.1
        ) {
          return []
        }
        return [{ node, element, transform }]
      })
      const spaceFrames = spaces.flatMap(space => {
        if (!space.rect) {
          return []
        }
        const element = canvas.querySelector<HTMLElement>(
          `[data-testid="workspace-space-region-${CSS.escape(space.id)}"]`,
        )
        if (!element) {
          return []
        }
        const style = getComputedStyle(element)
        return [
          {
            element,
            rect: space.rect,
            transform: style.transform,
            width: style.width,
            height: style.height,
          },
        ]
      })
      cancel()
      const transition = readThemeTransition(kind === 'arrange' ? 'fold' : 'unfold')
      const ratio = transition.durationMs / (kind === 'arrange' ? 280 : 360)
      const group = createCollapseAnimationGroup(() => {
        if (active.current === group) {
          active.current = null
        }
      }, transition.easing)
      active.current = group
      staggerUntil.current = performance.now() + 620 * ratio
      if (kind === 'arrange') {
        nodes.forEach((node, index) =>
          stagger.current.set(node.id, Math.min(index, 3) * 18 * ratio),
        )
      }
      for (const { node, element, transform } of nodeFrames) {
        group.animate(
          element,
          [{ transform }, { transform: `translate(${node.position.x}px, ${node.position.y}px)` }],
          (kind === 'arrange' ? 330 : 360) * ratio,
          kind === 'arrange' ? 210 * ratio + (stagger.current.get(node.id) ?? 0) : 0,
        )
      }
      for (const { element, rect, transform, width, height } of spaceFrames) {
        group.animate(
          element,
          [
            { transform, width, height },
            {
              transform: `translate(${rect.x}px, ${rect.y}px)`,
              width: `${rect.width}px`,
              height: `${rect.height}px`,
            },
          ],
          (kind === 'arrange' ? 270 : 360) * ratio,
          kind === 'arrange' ? 350 * ratio : 0,
        )
      }
      group.finish()
    },
    [canvasRef, cancel],
  )
  const getDelay = useCallback(
    (id: string) => (performance.now() < staggerUntil.current ? (stagger.current.get(id) ?? 0) : 0),
    [],
  )
  return { prepare, getDelay }
}
