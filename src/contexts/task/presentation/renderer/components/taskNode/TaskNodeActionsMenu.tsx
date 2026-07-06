import { useCallback, useRef, useState } from 'react'
import type { JSX } from 'react'
import { FileText, MoreHorizontal, Pencil } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import { ViewportMenuSurface } from '@app/renderer/components/ViewportMenuSurface'
import { TaskPromptTemplatesMenu } from '../promptTemplates/TaskPromptTemplatesMenu'

const TASK_NODE_MENU_ESTIMATED_HEIGHT = 84
const TASK_NODE_MENU_WIDTH = 188

export function TaskNodeActionsMenu({
  workspaceId,
  currentRequirement,
  onChangeRequirement,
  onOpenEditor,
}: {
  workspaceId: string | null
  currentRequirement: string
  onChangeRequirement: (nextRequirement: string) => void
  onOpenEditor: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const menuButtonRef = useRef<HTMLButtonElement | null>(null)
  const [menuPoint, setMenuPoint] = useState<{ x: number; y: number } | null>(null)
  const [promptTemplatesMenuAnchor, setPromptTemplatesMenuAnchor] = useState<{
    x: number
    y: number
  } | null>(null)

  const closeMenu = useCallback(() => {
    setMenuPoint(null)
  }, [])

  const closePromptTemplatesMenu = useCallback(() => {
    setPromptTemplatesMenuAnchor(null)
  }, [])

  const openPromptTemplatesMenu = useCallback(() => {
    const rect = menuButtonRef.current?.getBoundingClientRect()
    if (!rect) {
      closeMenu()
      return
    }

    closeMenu()
    setPromptTemplatesMenuAnchor({
      x: rect.right,
      y: rect.bottom + 6,
    })
  }, [closeMenu])

  const openEditor = useCallback(() => {
    closeMenu()
    onOpenEditor()
  }, [closeMenu, onOpenEditor])

  const isPromptTemplatesMenuOpen = promptTemplatesMenuAnchor !== null

  return (
    <>
      <button
        ref={menuButtonRef}
        type="button"
        className="task-node__icon-button task-node__icon-button--more nodrag"
        data-testid="task-node-more"
        onPointerDown={event => {
          event.stopPropagation()
        }}
        onClick={event => {
          event.stopPropagation()

          if (menuPoint) {
            closeMenu()
            return
          }

          const rect = event.currentTarget.getBoundingClientRect()
          setMenuPoint({
            x: rect.right,
            y: rect.bottom + 6,
          })
          closePromptTemplatesMenu()
        }}
        aria-haspopup="menu"
        aria-expanded={menuPoint !== null}
        aria-label={t('taskNode.moreActions')}
        title={t('taskNode.moreActions')}
      >
        <MoreHorizontal aria-hidden="true" />
      </button>

      {menuPoint ? (
        <ViewportMenuSurface
          open={true}
          className="workspace-context-menu workspace-canvas-context-menu task-node__menu"
          data-testid="task-node-menu"
          placement={{
            type: 'point',
            point: menuPoint,
            alignX: 'end',
            estimatedSize: {
              width: TASK_NODE_MENU_WIDTH,
              height: TASK_NODE_MENU_ESTIMATED_HEIGHT,
            },
          }}
          onDismiss={closeMenu}
          dismissOnPointerDownOutside={true}
          dismissOnEscape={true}
          dismissIgnoreRefs={[menuButtonRef]}
        >
          <button
            type="button"
            data-testid="task-node-open-prompt-templates"
            onClick={event => {
              event.stopPropagation()
              openPromptTemplatesMenu()
            }}
          >
            <FileText className="workspace-context-menu__icon" aria-hidden="true" />
            <span className="workspace-context-menu__label">
              {t('taskPromptTemplates.openMenu')}
            </span>
          </button>

          <button
            type="button"
            data-testid="task-node-open-editor"
            onClick={event => {
              event.stopPropagation()
              openEditor()
            }}
          >
            <Pencil className="workspace-context-menu__icon" aria-hidden="true" />
            <span className="workspace-context-menu__label">
              {t('taskNode.openFullTaskEditor')}
            </span>
          </button>
        </ViewportMenuSurface>
      ) : null}

      <TaskPromptTemplatesMenu
        isOpen={isPromptTemplatesMenuOpen}
        anchor={promptTemplatesMenuAnchor}
        workspaceId={workspaceId}
        closeMenu={closePromptTemplatesMenu}
        triggerRef={menuButtonRef}
        currentRequirement={currentRequirement}
        onChangeRequirement={onChangeRequirement}
        testIdPrefix="task-node"
      />
    </>
  )
}
