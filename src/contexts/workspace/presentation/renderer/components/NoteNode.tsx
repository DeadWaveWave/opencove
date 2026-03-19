import { useMemo } from 'react'
import type { JSX } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { NodeFrame, Point } from '../types'
import { NodeResizeHandles } from './shared/NodeResizeHandles'
import { useNodeFrameResize } from '../utils/nodeFrameResize'
import { shouldStopWheelPropagation } from './taskNode/helpers'

interface NoteNodeInteractionOptions {
  normalizeViewport?: boolean
  selectNode?: boolean
  clearSelection?: boolean
  shiftKey?: boolean
}

interface NoteNodeProps {
  text: string
  position: Point
  width: number
  height: number
  onClose: () => void
  onResize: (frame: NodeFrame) => void
  onTextChange: (text: string) => void
  onInteractionStart?: (options?: NoteNodeInteractionOptions) => void
}

export function NoteNode({
  text,
  position,
  width,
  height,
  onClose,
  onResize,
  onTextChange,
  onInteractionStart,
}: NoteNodeProps): JSX.Element {
  const { t } = useTranslation()
  const { draftFrame, handleResizePointerDown } = useNodeFrameResize({
    position,
    width,
    height,
    minSize: {
      width: 320,
      height: 220,
    },
    onResize,
  })

  const renderedFrame = draftFrame ?? {
    position,
    size: { width, height },
  }
  const style = useMemo(
    () => ({
      width: renderedFrame.size.width,
      height: renderedFrame.size.height,
      transform:
        renderedFrame.position.x !== position.x || renderedFrame.position.y !== position.y
          ? `translate(${renderedFrame.position.x - position.x}px, ${renderedFrame.position.y - position.y}px)`
          : undefined,
    }),
    [
      position.x,
      position.y,
      renderedFrame.position.x,
      renderedFrame.position.y,
      renderedFrame.size.height,
      renderedFrame.size.width,
    ],
  )

  return (
    <div
      className="note-node nowheel"
      style={style}
      onClickCapture={event => {
        if (event.button !== 0 || !(event.target instanceof Element)) {
          return
        }

        if (event.target.closest('.note-node__textarea')) {
          event.stopPropagation()
          onInteractionStart?.({
            normalizeViewport: true,
            clearSelection: true,
            selectNode: false,
            shiftKey: event.shiftKey,
          })
          return
        }

        if (event.target.closest('.nodrag')) {
          return
        }

        event.stopPropagation()
        onInteractionStart?.({ shiftKey: event.shiftKey })
      }}
      onWheel={event => {
        if (shouldStopWheelPropagation(event.currentTarget)) {
          event.stopPropagation()
        }
      }}
    >
      <div className="note-node__header" data-node-drag-handle="true">
        <span className="note-node__title" data-testid="note-node-title">
          {t('noteNode.title')}
        </span>
        <button
          type="button"
          className="note-node__close nodrag"
          onClick={event => {
            event.stopPropagation()
            onClose()
          }}
          aria-label={t('noteNode.deleteNote')}
          title={t('noteNode.deleteNote')}
        >
          ×
        </button>
      </div>

      <textarea
        className="note-node__textarea nodrag nowheel"
        data-testid="note-node-textarea"
        value={text}
        onPointerDownCapture={event => {
          event.stopPropagation()
        }}
        onPointerDown={event => {
          event.stopPropagation()
        }}
        onClick={event => {
          event.stopPropagation()
        }}
        onChange={event => {
          onTextChange(event.target.value)
        }}
      />

      <NodeResizeHandles
        classNamePrefix="task-node"
        testIdPrefix="note-resizer"
        handleResizePointerDown={handleResizePointerDown}
      />
    </div>
  )
}
