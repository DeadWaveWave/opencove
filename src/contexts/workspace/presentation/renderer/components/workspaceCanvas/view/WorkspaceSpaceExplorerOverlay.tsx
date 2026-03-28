import React from 'react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  FilePlus,
  FileText,
  Folder,
  FolderPlus,
  RefreshCw,
  X,
} from 'lucide-react'
import { useStore } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import { toFileUri } from '@contexts/filesystem/domain/fileUri'
import { shouldStopWheelPropagation } from '../../../components/taskNode/helpers'
import { selectViewportTransform } from './WorkspaceSpaceExplorerOverlay.helpers'
import {
  resolveExplorerAutoPreferredWidth,
  resolveExplorerPlacement,
} from './WorkspaceSpaceExplorerOverlay.layout'
import {
  useSpaceExplorerOverlayModel,
  type SpaceExplorerCreateMode,
  type SpaceExplorerRow,
} from './WorkspaceSpaceExplorerOverlay.model'

function renderRowDisclosure(row: Extract<SpaceExplorerRow, { kind: 'entry' }>): React.JSX.Element {
  if (row.entry.kind !== 'directory') {
    return <span className="workspace-space-explorer__entry-disclosure-placeholder" />
  }

  return row.isExpanded ? <ChevronDown /> : <ChevronRight />
}

function resolveCreateIcon(mode: Exclude<SpaceExplorerCreateMode, null>): React.JSX.Element {
  return mode === 'directory' ? <Folder aria-hidden="true" /> : <FileText aria-hidden="true" />
}

export function WorkspaceSpaceExplorerOverlay({
  canvasRef,
  spaceId,
  spaceName,
  directoryPath,
  rect,
  onClose,
  onOpenFile,
}: {
  canvasRef: React.RefObject<HTMLDivElement | null>
  spaceId: string
  spaceName: string
  directoryPath: string
  rect: { x: number; y: number; width: number; height: number }
  onClose: () => void
  onOpenFile: (
    uri: string,
    options?: {
      explorerPlacementPx?: { left: number; top: number; width: number; height: number }
    },
  ) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const transform = useStore(selectViewportTransform)
  const createInputRef = React.useRef<HTMLInputElement | null>(null)
  const resizeStartRef = React.useRef<{ startX: number; startWidth: number } | null>(null)
  const [manualWidth, setManualWidth] = React.useState<number | null>(null)
  const [canvasSize, setCanvasSize] = React.useState(() => ({
    width: 0,
    height: 0,
  }))

  const rootUri = React.useMemo(() => toFileUri(directoryPath.trim()), [directoryPath])

  const pixelRect = React.useMemo(() => {
    const [translateX, translateY, zoom] = transform
    return {
      x: rect.x * zoom + translateX,
      y: rect.y * zoom + translateY,
      width: rect.width * zoom,
      height: rect.height * zoom,
    }
  }, [rect.height, rect.width, rect.x, rect.y, transform])

  const placement = React.useMemo(() => {
    const canvasWidth = canvasSize.width > 0 ? canvasSize.width : 1280
    const canvasHeight = canvasSize.height > 0 ? canvasSize.height : 720
    const autoPreferredWidth = resolveExplorerAutoPreferredWidth(pixelRect.width)
    const preferredWidth = manualWidth ?? autoPreferredWidth
    return resolveExplorerPlacement({ canvasWidth, canvasHeight, pixelRect, preferredWidth })
  }, [canvasSize.height, canvasSize.width, manualWidth, pixelRect])

  const { isLoadingRoot, rootError, rows, selectedEntryUri, refresh, handleEntryActivate, create } =
    useSpaceExplorerOverlayModel({
      rootUri,
      spaceId,
      onOpenFile: uri => {
        onOpenFile(uri, {
          explorerPlacementPx: {
            left: placement.left,
            top: placement.top,
            width: placement.width,
            height: placement.height,
          },
        })
      },
    })
  const createRef = React.useRef(create)

  React.useEffect(() => {
    createRef.current = create
  }, [create])

  React.useEffect(() => {
    if (!create.mode) {
      return
    }

    const handle = window.setTimeout(() => {
      createInputRef.current?.focus()
      createInputRef.current?.select()
    }, 0)

    return () => {
      window.clearTimeout(handle)
    }
  }, [create.mode])

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      setCanvasSize({
        width: typeof window !== 'undefined' ? window.innerWidth : 0,
        height: typeof window !== 'undefined' ? window.innerHeight : 0,
      })
      return
    }

    const update = () => {
      setCanvasSize({
        width: Math.max(0, Math.round(canvas.clientWidth)),
        height: Math.max(0, Math.round(canvas.clientHeight)),
      })
    }

    update()
    const resizeObserver = new ResizeObserver(update)
    resizeObserver.observe(canvas)

    return () => {
      resizeObserver.disconnect()
    }
  }, [canvasRef])

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return
      }

      event.preventDefault()

      const currentCreate = createRef.current
      if (currentCreate.mode && !currentCreate.isCreating) {
        currentCreate.cancel()
        return
      }

      onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  React.useEffect(() => {
    const width = canvasSize.width
    const height = canvasSize.height
    if (width <= 0 || height <= 0) {
      return
    }

    const isSpaceVisible =
      pixelRect.x + pixelRect.width > 0 &&
      pixelRect.x < width &&
      pixelRect.y + pixelRect.height > 0 &&
      pixelRect.y < height

    if (!isSpaceVisible) {
      onClose()
    }
  }, [
    canvasSize.height,
    canvasSize.width,
    onClose,
    pixelRect.height,
    pixelRect.width,
    pixelRect.x,
    pixelRect.y,
  ])

  const body = isLoadingRoot ? (
    <div className="workspace-space-explorer__state">{t('common.loading')}</div>
  ) : rootError ? (
    <div className="workspace-space-explorer__state workspace-space-explorer__state--error">
      <div className="workspace-space-explorer__state-title">{t('common.error')}</div>
      <div className="workspace-space-explorer__state-message">{rootError}</div>
      <button
        type="button"
        className="workspace-space-explorer__state-action"
        onClick={event => {
          event.stopPropagation()
          refresh()
        }}
      >
        {t('documentNode.retry')}
      </button>
    </div>
  ) : rows.length === 0 ? (
    <div className="workspace-space-explorer__state">{t('spaceExplorer.empty')}</div>
  ) : (
    <div
      className="workspace-space-explorer__tree"
      onWheel={event => {
        if (shouldStopWheelPropagation(event.currentTarget)) {
          event.stopPropagation()
        }
      }}
    >
      {rows.map(row => {
        if (row.kind === 'state') {
          return (
            <div
              key={row.id}
              className={
                row.stateKind === 'error'
                  ? 'workspace-space-explorer__tree-state workspace-space-explorer__tree-state--error'
                  : 'workspace-space-explorer__tree-state'
              }
              style={{ paddingLeft: `${16 + row.depth * 14}px` }}
            >
              {row.message}
            </div>
          )
        }

        return (
          <button
            key={row.entry.uri}
            type="button"
            className={
              selectedEntryUri === row.entry.uri
                ? 'workspace-space-explorer__entry workspace-space-explorer__entry--selected'
                : 'workspace-space-explorer__entry'
            }
            data-testid={`workspace-space-explorer-entry-${spaceId}-${encodeURIComponent(row.entry.uri)}`}
            title={row.entry.name}
            style={{ paddingLeft: `${10 + row.depth * 14}px` }}
            onClick={event => {
              event.stopPropagation()
              handleEntryActivate(row.entry)
            }}
          >
            <span className="workspace-space-explorer__entry-disclosure" aria-hidden="true">
              {renderRowDisclosure(row)}
            </span>
            {row.entry.kind === 'directory' ? (
              <Folder className="workspace-space-explorer__entry-icon" aria-hidden="true" />
            ) : (
              <FileText className="workspace-space-explorer__entry-icon" aria-hidden="true" />
            )}
            <span className="workspace-space-explorer__entry-label">{row.entry.name}</span>
          </button>
        )
      })}
    </div>
  )

  return (
    <section
      className="workspace-space-explorer workspace-space-explorer--inside"
      data-testid="workspace-space-explorer"
      style={{
        width: placement.width,
        height: placement.height,
        left: placement.left,
        top: placement.top,
      }}
      onPointerDown={event => {
        event.stopPropagation()
      }}
      onClick={event => {
        event.stopPropagation()
      }}
      onWheelCapture={event => {
        event.stopPropagation()
      }}
    >
      <header className="workspace-space-explorer__header">
        <div className="workspace-space-explorer__title" title={spaceName}>
          {t('spaceActions.files')}
        </div>
        <div className="workspace-space-explorer__header-actions">
          <button
            type="button"
            className="workspace-space-explorer__header-action"
            aria-label={t('spaceExplorer.newFile')}
            title={t('spaceExplorer.newFile')}
            disabled={!!rootError}
            onClick={event => {
              event.stopPropagation()
              create.start('file')
            }}
          >
            <FilePlus aria-hidden="true" />
          </button>
          <button
            type="button"
            className="workspace-space-explorer__header-action"
            aria-label={t('spaceExplorer.newFolder')}
            title={t('spaceExplorer.newFolder')}
            disabled={!!rootError}
            onClick={event => {
              event.stopPropagation()
              create.start('directory')
            }}
          >
            <FolderPlus aria-hidden="true" />
          </button>
          <button
            type="button"
            className="workspace-space-explorer__header-action"
            aria-label={t('spaceExplorer.refresh')}
            title={t('spaceExplorer.refresh')}
            onClick={event => {
              event.stopPropagation()
              refresh()
            }}
          >
            <RefreshCw aria-hidden="true" />
          </button>
          <button
            type="button"
            className="workspace-space-explorer__header-action workspace-space-explorer__header-action--close"
            aria-label={t('common.close')}
            title={t('common.close')}
            onClick={event => {
              event.stopPropagation()
              onClose()
            }}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="workspace-space-explorer__body">
        {create.mode ? (
          <form
            className="workspace-space-explorer__create"
            onSubmit={event => {
              event.preventDefault()
              event.stopPropagation()
              void create.submit()
            }}
          >
            <span className="workspace-space-explorer__create-icon" aria-hidden="true">
              {resolveCreateIcon(create.mode)}
            </span>
            <input
              ref={createInputRef}
              className="workspace-space-explorer__create-input"
              value={create.draftName}
              placeholder={
                create.mode === 'directory'
                  ? t('spaceExplorer.folderNamePlaceholder')
                  : t('spaceExplorer.fileNamePlaceholder')
              }
              disabled={create.isCreating}
              onChange={event => {
                create.setDraftName(event.target.value)
              }}
              onKeyDown={event => {
                if (event.key !== 'Escape') {
                  return
                }

                event.preventDefault()
                event.stopPropagation()
                if (!create.isCreating) {
                  create.cancel()
                }
              }}
            />
            <button
              type="submit"
              className="workspace-space-explorer__create-action"
              disabled={create.isCreating}
              aria-label={t('spaceExplorer.create')}
              title={t('spaceExplorer.create')}
            >
              <Check aria-hidden="true" />
            </button>
            <button
              type="button"
              className="workspace-space-explorer__create-action workspace-space-explorer__create-action--cancel"
              disabled={create.isCreating}
              aria-label={t('common.cancel')}
              title={t('common.cancel')}
              onClick={event => {
                event.stopPropagation()
                create.cancel()
              }}
            >
              <X aria-hidden="true" />
            </button>
            {create.error ? (
              <div className="workspace-space-explorer__create-error" role="status">
                {create.error}
              </div>
            ) : null}
          </form>
        ) : null}
        {body}
      </div>

      <div
        className="workspace-space-explorer__resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('spaceExplorer.resizeWidth')}
        onPointerDown={event => {
          event.stopPropagation()
          if (event.button !== 0) {
            return
          }

          resizeStartRef.current = {
            startX: event.clientX,
            startWidth: placement.width,
          }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={event => {
          const resizeStart = resizeStartRef.current
          if (!resizeStart) {
            return
          }

          event.stopPropagation()
          const delta = event.clientX - resizeStart.startX
          const unclampedWidth = resizeStart.startWidth + delta
          const nextWidth = Math.min(
            placement.maxWidth,
            Math.max(placement.minWidth, unclampedWidth),
          )
          setManualWidth(nextWidth)
        }}
        onPointerUp={event => {
          if (!resizeStartRef.current) {
            return
          }

          event.stopPropagation()
          resizeStartRef.current = null
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
        }}
        onPointerCancel={event => {
          if (!resizeStartRef.current) {
            return
          }

          event.stopPropagation()
          resizeStartRef.current = null
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
        }}
      />
    </section>
  )
}
