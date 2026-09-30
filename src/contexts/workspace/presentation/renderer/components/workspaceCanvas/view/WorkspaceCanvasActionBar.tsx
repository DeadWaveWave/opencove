import React from 'react'
import { Globe, ListTodo, Scan, StickyNote, TerminalSquare } from 'lucide-react'
import { PluginIcon } from '@contexts/plugins/presentation/renderer/PluginIcon'
import { AgentProviderIcon } from '@app/renderer/components/AgentProviderIcon'
import { useTranslation } from '@app/renderer/i18n'
import type { AgentNodeData } from '../../../types'
import { useLocalPluginContributions } from '@contexts/plugins/presentation/renderer/useLocalPluginContributions'

export type WorkspaceCanvasActionKind =
  | 'agent'
  | 'terminal'
  | 'note'
  | 'task'
  | 'website'
  | 'space'
  | `plugin:${string}`

interface WorkspaceCanvasActionBarProps {
  canvasRef: React.RefObject<HTMLDivElement | null>
  defaultAgentProvider: AgentNodeData['provider']
  onCreateAtCenter: (kind: WorkspaceCanvasActionKind) => void | Promise<void>
  onCreateAtPoint: (
    kind: WorkspaceCanvasActionKind,
    point: { x: number; y: number },
  ) => void | Promise<void>
  onInteractionStart?: () => void
  resolveDropTargetLabel?: (point: { x: number; y: number }) => string | null
}

interface DragState {
  kind: WorkspaceCanvasActionKind
  pointerId: number
  startX: number
  startY: number
  clientX: number
  clientY: number
  moved: boolean
}

const DRAG_THRESHOLD = 6

export function WorkspaceCanvasActionBar({
  canvasRef,
  defaultAgentProvider,
  onCreateAtCenter,
  onCreateAtPoint,
  onInteractionStart,
  resolveDropTargetLabel,
}: WorkspaceCanvasActionBarProps): React.JSX.Element {
  const { t } = useTranslation()
  const localPlugins = useLocalPluginContributions('actionBar')
  const dragRef = React.useRef<DragState | null>(null)
  const [dragState, setDragState] = React.useState<DragState | null>(null)

  const clearDrag = React.useCallback(() => {
    dragRef.current = null
    setDragState(null)
  }, [])

  React.useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const current = dragRef.current
      if (!current || current.pointerId !== event.pointerId) {
        return
      }

      const moved =
        current.moved ||
        Math.hypot(event.clientX - current.startX, event.clientY - current.startY) >= DRAG_THRESHOLD
      const next = {
        ...current,
        clientX: event.clientX,
        clientY: event.clientY,
        moved,
      }
      dragRef.current = next
      setDragState(next)
    }

    const handlePointerUp = (event: PointerEvent) => {
      const current = dragRef.current
      if (!current || current.pointerId !== event.pointerId) {
        return
      }

      const rect = canvasRef.current?.getBoundingClientRect() ?? null
      const hitTarget = document.elementFromPoint(event.clientX, event.clientY)
      const insideCanvas =
        rect !== null &&
        !(hitTarget instanceof Element && hitTarget.closest('.workspace-canvas__action-bar')) &&
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom

      if (!current.moved) {
        void onCreateAtCenter(current.kind)
      } else if (insideCanvas) {
        void onCreateAtPoint(current.kind, { x: event.clientX, y: event.clientY })
      }
      clearDrag()
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp, true)
    window.addEventListener('pointercancel', clearDrag, true)
    window.addEventListener('blur', clearDrag)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp, true)
      window.removeEventListener('pointercancel', clearDrag, true)
      window.removeEventListener('blur', clearDrag)
    }
  }, [canvasRef, clearDrag, onCreateAtCenter, onCreateAtPoint])

  const actions: Array<{
    kind: WorkspaceCanvasActionKind
    label: string
    hint: string
    icon: React.ReactNode
  }> = [
    {
      kind: 'agent',
      label: t('workspaceCanvas.actionBar.agent'),
      hint: t('workspaceCanvas.actionBar.agentHint'),
      icon: <AgentProviderIcon provider={defaultAgentProvider} />,
    },
    {
      kind: 'terminal',
      label: t('workspaceCanvas.actionBar.terminal'),
      hint: t('workspaceCanvas.actionBar.terminalHint'),
      icon: <TerminalSquare aria-hidden="true" />,
    },
    {
      kind: 'note',
      label: t('workspaceCanvas.actionBar.note'),
      hint: t('workspaceCanvas.actionBar.noteHint'),
      icon: <StickyNote aria-hidden="true" />,
    },
    {
      kind: 'task',
      label: t('workspaceCanvas.actionBar.task'),
      hint: t('workspaceCanvas.actionBar.taskHint'),
      icon: <ListTodo aria-hidden="true" />,
    },
    {
      kind: 'website',
      label: t('workspaceCanvas.actionBar.website'),
      hint: t('workspaceCanvas.actionBar.websiteHint'),
      icon: <Globe aria-hidden="true" />,
    },
    {
      kind: 'space',
      label: t('workspaceCanvas.actionBar.space'),
      hint: t('workspaceCanvas.actionBar.spaceHint'),
      icon: <Scan aria-hidden="true" />,
    },
  ]
  for (const plugin of localPlugins) {
    actions.push({
      kind: `plugin:${plugin.id}`,
      label: plugin.displayName,
      hint: plugin.description,
      icon: <PluginIcon pluginId={plugin.id} />,
    })
  }

  const previewRect = canvasRef.current?.getBoundingClientRect() ?? null
  const previewInsideCanvas =
    dragState !== null &&
    previewRect !== null &&
    dragState.clientX >= previewRect.left &&
    dragState.clientX <= previewRect.right &&
    dragState.clientY >= previewRect.top &&
    dragState.clientY <= previewRect.bottom
  const activeAction = actions.find(action => action.kind === dragState?.kind) ?? null
  const dropTargetLabel =
    dragState && previewInsideCanvas
      ? (resolveDropTargetLabel?.({ x: dragState.clientX, y: dragState.clientY }) ??
        t('workspaceCanvas.actionBar.targetCanvas'))
      : null

  return (
    <>
      <aside
        className="workspace-canvas__action-bar"
        data-testid="workspace-canvas-action-bar"
        data-cove-action-bar-dragging={dragState?.moved ? 'true' : undefined}
        aria-label={t('workspaceCanvas.actionBar.title')}
        onPointerDown={event => event.stopPropagation()}
      >
        <div className="workspace-canvas__action-bar-tools" role="toolbar">
          {actions.map(action => (
            <button
              key={action.kind}
              type="button"
              className="workspace-canvas__action-bar-button"
              data-testid={`workspace-canvas-action-bar-new-${action.kind}`}
              aria-label={action.label}
              title={`${action.label} · ${action.hint}`}
              onPointerDown={event => {
                if (event.button !== 0) {
                  return
                }
                event.preventDefault()
                event.stopPropagation()
                onInteractionStart?.()
                event.currentTarget.setPointerCapture?.(event.pointerId)
                const next = {
                  kind: action.kind,
                  pointerId: event.pointerId,
                  startX: event.clientX,
                  startY: event.clientY,
                  clientX: event.clientX,
                  clientY: event.clientY,
                  moved: false,
                }
                dragRef.current = next
                setDragState(next)
              }}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  void onCreateAtCenter(action.kind)
                }
              }}
            >
              <span className="workspace-canvas__action-bar-icon" aria-hidden="true">
                {action.icon}
              </span>
              <span className="workspace-canvas__action-bar-label">{action.label}</span>
            </button>
          ))}
        </div>
        <div className="workspace-canvas__action-bar-footer" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </aside>

      {dragState?.moved && previewInsideCanvas && previewRect && activeAction ? (
        <div
          className="workspace-canvas__action-bar-drop-preview"
          data-testid="workspace-canvas-action-bar-drop-preview"
          style={{
            left: dragState.clientX - previewRect.left,
            top: dragState.clientY - previewRect.top,
          }}
          aria-hidden="true"
        >
          <span className="workspace-canvas__action-bar-drop-preview-pixel" />
          <span className="workspace-canvas__action-bar-drop-preview-label">
            {activeAction.label} · {dropTargetLabel}
          </span>
        </div>
      ) : null}
    </>
  )
}
