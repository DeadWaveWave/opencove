import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { WorkspaceSpaceState } from '../../../types'
import type {
  WorkspaceArrangeOrder,
  WorkspaceArrangeSpaceFit,
  WorkspaceArrangeStyle,
} from '../../../utils/workspaceArrange'
import type { ContextMenuState } from '../types'
import type { ArrangeScope } from './WorkspaceContextArrangeBySubmenu'
import { isPointWithinRect } from './WorkspaceContextMenu.helpers'

export function useWorkspaceContextArrangeMenuState(params: {
  contextMenu: ContextMenuState | null
  spaces: WorkspaceSpaceState[]
  arrangeAll: (style?: WorkspaceArrangeStyle) => void
  arrangeCanvas: (style?: WorkspaceArrangeStyle) => void
  arrangeInSpace: (spaceId: string, style?: WorkspaceArrangeStyle) => void
}): {
  contextHitSpace: WorkspaceSpaceState | null
  arrangeScope: ArrangeScope
  arrangeOrder: WorkspaceArrangeOrder
  arrangeSpaceFit: WorkspaceArrangeSpaceFit
  applyArrange: (options?: { scope?: ArrangeScope; style?: WorkspaceArrangeStyle }) => void
  handleArrangeScopeSelect: (scope: ArrangeScope) => void
  handleArrangeOrderSelect: (order: WorkspaceArrangeOrder) => void
  handleArrangeSpaceFitSelect: (spaceFit: WorkspaceArrangeSpaceFit) => void
} {
  const { contextMenu, spaces, arrangeAll, arrangeCanvas, arrangeInSpace } = params

  const [contextHitSpaceId, setContextHitSpaceId] = useState<string | null>(null)
  const contextHitSpaceIdRef = useRef<string | null>(null)

  const [arrangeScope, setArrangeScope] = useState<ArrangeScope>('canvas')
  const arrangeScopeRef = useRef<ArrangeScope>('canvas')
  const [arrangeOrder, setArrangeOrder] = useState<WorkspaceArrangeOrder>('position')
  const arrangeOrderRef = useRef<WorkspaceArrangeOrder>('position')
  const [arrangeSpaceFit, setArrangeSpaceFit] = useState<WorkspaceArrangeSpaceFit>('tight')
  const arrangeSpaceFitRef = useRef<WorkspaceArrangeSpaceFit>('tight')

  useEffect(() => {
    if (!contextMenu || contextMenu.kind !== 'pane') {
      contextHitSpaceIdRef.current = null
      setContextHitSpaceId(null)
      arrangeScopeRef.current = 'canvas'
      setArrangeScope('canvas')
      return
    }

    const anchor = { x: contextMenu.flowX, y: contextMenu.flowY }
    const hitSpace =
      spaces.find(space => space.rect && isPointWithinRect(anchor, space.rect)) ?? null
    const nextHitSpaceId = hitSpace?.id ?? null

    contextHitSpaceIdRef.current = nextHitSpaceId
    setContextHitSpaceId(nextHitSpaceId)

    const nextScope: ArrangeScope = nextHitSpaceId ? 'space' : 'canvas'
    arrangeScopeRef.current = nextScope
    setArrangeScope(nextScope)
  }, [contextMenu, spaces])

  const contextHitSpace = useMemo(() => {
    if (!contextHitSpaceId) {
      return null
    }

    return spaces.find(space => space.id === contextHitSpaceId) ?? null
  }, [contextHitSpaceId, spaces])

  const resolveCurrentArrangeStyle = useCallback((): WorkspaceArrangeStyle => {
    return {
      order: arrangeOrderRef.current,
      spaceFit: arrangeSpaceFitRef.current,
    }
  }, [])

  const applyArrange = useCallback(
    (options?: { scope?: ArrangeScope; style?: WorkspaceArrangeStyle }) => {
      const scope = options?.scope ?? arrangeScopeRef.current
      const style = options?.style ?? resolveCurrentArrangeStyle()

      if (scope === 'all') {
        arrangeAll(style)
        return
      }

      if (scope === 'canvas') {
        arrangeCanvas(style)
        return
      }

      const spaceId = contextHitSpaceIdRef.current
      if (spaceId) {
        arrangeInSpace(spaceId, style)
      }
    },
    [arrangeAll, arrangeCanvas, arrangeInSpace, resolveCurrentArrangeStyle],
  )

  const handleArrangeScopeSelect = useCallback(
    (scope: ArrangeScope) => {
      arrangeScopeRef.current = scope
      setArrangeScope(scope)
      applyArrange({ scope })
    },
    [applyArrange],
  )

  const handleArrangeOrderSelect = useCallback(
    (order: WorkspaceArrangeOrder) => {
      arrangeOrderRef.current = order
      setArrangeOrder(order)
      applyArrange()
    },
    [applyArrange],
  )

  const handleArrangeSpaceFitSelect = useCallback(
    (spaceFit: WorkspaceArrangeSpaceFit) => {
      arrangeSpaceFitRef.current = spaceFit
      setArrangeSpaceFit(spaceFit)
      applyArrange()
    },
    [applyArrange],
  )

  return {
    contextHitSpace,
    arrangeScope,
    arrangeOrder,
    arrangeSpaceFit,
    applyArrange,
    handleArrangeScopeSelect,
    handleArrangeOrderSelect,
    handleArrangeSpaceFitSelect,
  }
}
