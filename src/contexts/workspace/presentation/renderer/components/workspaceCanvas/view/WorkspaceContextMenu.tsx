import React from 'react'
import {
  ArrowLeft,
  ArrowRight,
  FileText,
  Group,
  LayoutGrid,
  ListTodo,
  Play,
  SlidersHorizontal,
  Terminal,
  X,
} from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import type { ContextMenuState } from '../types'
import type { WorkspaceSpaceState } from '../../../types'
import type {
  WorkspaceArrangeOrder,
  WorkspaceArrangePaper,
  WorkspaceArrangeSpaceFit,
  WorkspaceArrangeStyle,
} from '../../../utils/workspaceArrange'

interface WorkspaceContextMenuProps {
  contextMenu: ContextMenuState | null
  closeContextMenu: () => void
  createTerminalNode: () => Promise<void>
  createNoteNodeFromContextMenu: () => void
  openTaskCreator: () => void
  openAgentLauncher: () => void
  spaces: WorkspaceSpaceState[]
  canArrangeAll: boolean
  canArrangeCanvas: boolean
  arrangeAll: (style?: WorkspaceArrangeStyle) => void
  arrangeCanvas: (style?: WorkspaceArrangeStyle) => void
  arrangeInSpace: (spaceId: string, style?: WorkspaceArrangeStyle) => void
  createSpaceFromSelectedNodes: () => void
  clearNodeSelection: () => void
  canConvertSelectedNoteToTask: boolean
  isConvertSelectedNoteToTaskDisabled: boolean
  convertSelectedNoteToTask: () => void
}

type ArrangePanelScope = 'all' | 'canvas' | 'space'

function isPointWithinRect(
  point: { x: number; y: number },
  rect: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    point.x >= rect.x &&
    point.y >= rect.y &&
    point.x <= rect.x + rect.width &&
    point.y <= rect.y + rect.height
  )
}

export function WorkspaceContextMenu({
  contextMenu,
  closeContextMenu,
  createTerminalNode,
  createNoteNodeFromContextMenu,
  openTaskCreator,
  openAgentLauncher,
  spaces,
  canArrangeAll,
  canArrangeCanvas,
  arrangeAll,
  arrangeCanvas,
  arrangeInSpace,
  createSpaceFromSelectedNodes,
  clearNodeSelection,
  canConvertSelectedNoteToTask,
  isConvertSelectedNoteToTaskDisabled,
  convertSelectedNoteToTask,
}: WorkspaceContextMenuProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const [activeView, setActiveView] = React.useState<'menu' | 'arrange'>('menu')
  const hitSpace = React.useMemo(() => {
    if (!contextMenu || contextMenu.kind !== 'pane') {
      return null
    }

    const anchor = { x: contextMenu.flowX, y: contextMenu.flowY }
    return spaces.find(space => space.rect && isPointWithinRect(anchor, space.rect)) ?? null
  }, [contextMenu, spaces])
  const [arrangeScope, setArrangeScope] = React.useState<ArrangePanelScope>('all')
  const [arrangeOrder, setArrangeOrder] = React.useState<WorkspaceArrangeOrder>('position')
  const [arrangeSpaceFit, setArrangeSpaceFit] = React.useState<WorkspaceArrangeSpaceFit>('tight')
  const [arrangePaper, setArrangePaper] = React.useState<WorkspaceArrangePaper>('none')
  const [isDensePackingEnabled, setIsDensePackingEnabled] = React.useState(false)
  const hitSpaceId = hitSpace?.id ?? null

  React.useEffect(() => {
    setActiveView('menu')
    setArrangeScope(hitSpaceId ? 'space' : 'all')
  }, [contextMenu?.kind, contextMenu?.x, contextMenu?.y, hitSpaceId])

  const arrangeStyle: WorkspaceArrangeStyle = React.useMemo(
    () => ({
      order: arrangeOrder,
      spaceFit: arrangeSpaceFit,
      paper: arrangePaper,
      dense: isDensePackingEnabled,
    }),
    [arrangeOrder, arrangePaper, arrangeSpaceFit, isDensePackingEnabled],
  )

  const applyArrange = React.useCallback(() => {
    closeContextMenu()

    if (arrangeScope === 'all') {
      arrangeAll(arrangeStyle)
      return
    }

    if (arrangeScope === 'canvas') {
      arrangeCanvas(arrangeStyle)
      return
    }

    if (hitSpace) {
      arrangeInSpace(hitSpace.id, arrangeStyle)
    }
  }, [
    arrangeAll,
    arrangeCanvas,
    arrangeInSpace,
    arrangeScope,
    arrangeStyle,
    closeContextMenu,
    hitSpace,
  ])

  if (!contextMenu) {
    return null
  }

  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : contextMenu.x
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : contextMenu.y
  const margin = 12
  const anchorX = Math.min(
    Math.max(contextMenu.x, margin),
    Math.max(margin, viewportWidth - margin),
  )
  const anchorY = Math.min(
    Math.max(contextMenu.y, margin),
    Math.max(margin, viewportHeight - margin),
  )
  const flipX = contextMenu.x > viewportWidth / 2
  const flipY = contextMenu.y > viewportHeight / 2
  const transform =
    flipX || flipY ? `translate(${flipX ? '-100%' : '0'}, ${flipY ? '-100%' : '0'})` : undefined

  const canArrangeHitSpace = Boolean(hitSpace && hitSpace.nodeIds.length >= 1)
  const canApplyArrange = (() => {
    if (arrangeScope === 'all') {
      return canArrangeAll
    }

    if (arrangeScope === 'canvas') {
      return canArrangeCanvas
    }

    return canArrangeHitSpace
  })()

  return (
    <div
      className="workspace-context-menu"
      style={{ top: anchorY, left: anchorX, transform }}
      onClick={event => {
        event.stopPropagation()
      }}
    >
      {contextMenu.kind === 'pane' ? (
        <>
          {activeView === 'menu' ? (
            <>
              <button
                type="button"
                data-testid="workspace-context-new-terminal"
                onClick={() => {
                  void createTerminalNode()
                }}
              >
                <Terminal className="workspace-context-menu__icon" aria-hidden="true" />
                <span className="workspace-context-menu__label">
                  {t('workspaceContextMenu.newTerminal')}
                </span>
              </button>
              <button
                type="button"
                data-testid="workspace-context-new-note"
                onClick={() => {
                  createNoteNodeFromContextMenu()
                }}
              >
                <FileText className="workspace-context-menu__icon" aria-hidden="true" />
                <span className="workspace-context-menu__label">
                  {t('workspaceContextMenu.newNote')}
                </span>
              </button>
              <button
                type="button"
                data-testid="workspace-context-new-task"
                onClick={() => {
                  openTaskCreator()
                }}
              >
                <ListTodo className="workspace-context-menu__icon" aria-hidden="true" />
                <span className="workspace-context-menu__label">
                  {t('workspaceContextMenu.newTask')}
                </span>
              </button>
              <button
                type="button"
                data-testid="workspace-context-run-default-agent"
                onClick={() => {
                  openAgentLauncher()
                }}
              >
                <Play className="workspace-context-menu__icon" aria-hidden="true" />
                <span className="workspace-context-menu__label">
                  {t('workspaceContextMenu.runAgent')}
                </span>
              </button>

              <div className="workspace-context-menu__separator" />

              {hitSpace ? (
                <button
                  type="button"
                  data-testid="workspace-context-arrange-in-space"
                  disabled={!canArrangeHitSpace}
                  onClick={() => {
                    closeContextMenu()
                    arrangeInSpace(hitSpace.id)
                  }}
                >
                  <LayoutGrid className="workspace-context-menu__icon" aria-hidden="true" />
                  <span className="workspace-context-menu__label">
                    {t('workspaceContextMenu.arrangeInSpace')}
                  </span>
                </button>
              ) : null}

              <button
                type="button"
                data-testid="workspace-context-arrange-all"
                disabled={!canArrangeAll}
                onClick={() => {
                  closeContextMenu()
                  arrangeAll()
                }}
              >
                <LayoutGrid className="workspace-context-menu__icon" aria-hidden="true" />
                <span className="workspace-context-menu__label">
                  {t('workspaceContextMenu.arrangeAll')}
                </span>
              </button>

              <button
                type="button"
                data-testid="workspace-context-arrange-canvas"
                disabled={!canArrangeCanvas}
                onClick={() => {
                  closeContextMenu()
                  arrangeCanvas()
                }}
              >
                <LayoutGrid className="workspace-context-menu__icon" aria-hidden="true" />
                <span className="workspace-context-menu__label">
                  {t('workspaceContextMenu.arrangeCanvas')}
                </span>
              </button>

              <button
                type="button"
                data-testid="workspace-context-arrange-panel-open"
                onClick={() => {
                  setActiveView('arrange')
                }}
              >
                <SlidersHorizontal className="workspace-context-menu__icon" aria-hidden="true" />
                <span className="workspace-context-menu__label">
                  {t('workspaceContextMenu.arrangePanel')}
                </span>
              </button>
            </>
          ) : (
            <div
              className="workspace-arrange-panel"
              data-testid="workspace-arrange-panel"
              onClick={event => {
                event.stopPropagation()
              }}
            >
              <header className="workspace-arrange-panel__header">
                <button
                  type="button"
                  className="workspace-arrange-panel__back"
                  data-testid="workspace-arrange-panel-back"
                  onClick={() => {
                    setActiveView('menu')
                  }}
                >
                  <ArrowLeft className="workspace-context-menu__icon" aria-hidden="true" />
                </button>
                <span className="workspace-arrange-panel__title">
                  {t('workspaceArrangePanel.title')}
                </span>
              </header>

              <div className="workspace-arrange-panel__section">
                <div className="workspace-arrange-panel__label">
                  {t('workspaceArrangePanel.scope')}
                </div>
                <div className="workspace-arrange-panel__segmented">
                  <button
                    type="button"
                    data-testid="workspace-arrange-panel-scope-all"
                    aria-pressed={arrangeScope === 'all'}
                    disabled={!canArrangeAll}
                    onClick={() => setArrangeScope('all')}
                  >
                    {t('workspaceArrangePanel.scopeAll')}
                  </button>
                  <button
                    type="button"
                    data-testid="workspace-arrange-panel-scope-canvas"
                    aria-pressed={arrangeScope === 'canvas'}
                    disabled={!canArrangeCanvas}
                    onClick={() => setArrangeScope('canvas')}
                  >
                    {t('workspaceArrangePanel.scopeCanvas')}
                  </button>
                  <button
                    type="button"
                    data-testid="workspace-arrange-panel-scope-space"
                    aria-pressed={arrangeScope === 'space'}
                    disabled={!canArrangeHitSpace}
                    onClick={() => setArrangeScope('space')}
                  >
                    {t('workspaceArrangePanel.scopeSpace')}
                  </button>
                </div>
              </div>

              <div className="workspace-arrange-panel__section">
                <label className="workspace-arrange-panel__field">
                  <span className="workspace-arrange-panel__label">
                    {t('workspaceArrangePanel.order')}
                  </span>
                  <select
                    className="workspace-arrange-panel__select"
                    data-testid="workspace-arrange-panel-order"
                    value={arrangeOrder}
                    onChange={event => setArrangeOrder(event.target.value as WorkspaceArrangeOrder)}
                  >
                    <option value="position">{t('workspaceArrangePanel.orderPosition')}</option>
                    <option value="createdAt">{t('workspaceArrangePanel.orderCreatedAt')}</option>
                    <option value="kind">{t('workspaceArrangePanel.orderKind')}</option>
                    <option value="size">{t('workspaceArrangePanel.orderSize')}</option>
                  </select>
                </label>

                <label className="workspace-arrange-panel__field">
                  <span className="workspace-arrange-panel__label">
                    {t('workspaceArrangePanel.spaceFit')}
                  </span>
                  <select
                    className="workspace-arrange-panel__select"
                    data-testid="workspace-arrange-panel-space-fit"
                    value={arrangeSpaceFit}
                    onChange={event =>
                      setArrangeSpaceFit(event.target.value as WorkspaceArrangeSpaceFit)
                    }
                  >
                    <option value="tight">{t('workspaceArrangePanel.spaceFitTight')}</option>
                    <option value="grow">{t('workspaceArrangePanel.spaceFitGrow')}</option>
                    <option value="keep">{t('workspaceArrangePanel.spaceFitKeep')}</option>
                  </select>
                </label>

                <label className="workspace-arrange-panel__toggle">
                  <input
                    type="checkbox"
                    data-testid="workspace-arrange-panel-paper-a4"
                    checked={arrangePaper === 'a4'}
                    onChange={event =>
                      setArrangePaper(
                        (event.target.checked ? 'a4' : 'none') as WorkspaceArrangePaper,
                      )
                    }
                  />
                  <span>{t('workspaceArrangePanel.paperA4')}</span>
                </label>

                <label className="workspace-arrange-panel__toggle">
                  <input
                    type="checkbox"
                    data-testid="workspace-arrange-panel-dense"
                    checked={isDensePackingEnabled}
                    onChange={event => setIsDensePackingEnabled(event.target.checked)}
                  />
                  <span>{t('workspaceArrangePanel.dense')}</span>
                </label>

                {arrangePaper === 'a4' ? (
                  <div className="workspace-arrange-panel__hint">
                    {t('workspaceArrangePanel.paperHint')}
                  </div>
                ) : null}
              </div>

              <footer className="workspace-arrange-panel__footer">
                <button
                  type="button"
                  data-testid="workspace-arrange-panel-cancel"
                  className="workspace-arrange-panel__button workspace-arrange-panel__button--ghost"
                  onClick={() => {
                    setActiveView('menu')
                  }}
                >
                  {t('workspaceArrangePanel.cancel')}
                </button>
                <button
                  type="button"
                  data-testid="workspace-arrange-panel-apply"
                  className="workspace-arrange-panel__button workspace-arrange-panel__button--primary"
                  disabled={!canApplyArrange}
                  onClick={applyArrange}
                >
                  {t('workspaceArrangePanel.apply')}
                </button>
              </footer>
            </div>
          )}
        </>
      ) : (
        <>
          <button
            type="button"
            data-testid="workspace-selection-create-space"
            onClick={() => {
              createSpaceFromSelectedNodes()
            }}
          >
            <Group className="workspace-context-menu__icon" aria-hidden="true" />
            <span className="workspace-context-menu__label">
              {t('workspaceContextMenu.createSpaceWithSelected')}
            </span>
          </button>
          {canConvertSelectedNoteToTask ? (
            <button
              type="button"
              data-testid="workspace-selection-convert-note-to-task"
              disabled={isConvertSelectedNoteToTaskDisabled}
              onClick={() => {
                convertSelectedNoteToTask()
              }}
            >
              <ArrowRight className="workspace-context-menu__icon" aria-hidden="true" />
              <span className="workspace-context-menu__label">
                {t('workspaceContextMenu.convertToTask')}
              </span>
            </button>
          ) : null}
          <button
            type="button"
            data-testid="workspace-selection-clear"
            onClick={() => {
              clearNodeSelection()
              closeContextMenu()
            }}
          >
            <X className="workspace-context-menu__icon" aria-hidden="true" />
            <span className="workspace-context-menu__label">
              {t('workspaceContextMenu.clearSelection')}
            </span>
          </button>
        </>
      )}
    </div>
  )
}
