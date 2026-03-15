import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX, PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { Size } from '../types'
import { shouldStopWheelPropagation } from './taskNode/helpers'

interface NoteNodeInteractionOptions {
  normalizeViewport?: boolean
  selectNode?: boolean
  clearSelection?: boolean
  shiftKey?: boolean
}

interface NoteNodeProps {
  text: string
  width: number
  height: number
  onClose: () => void
  onResize: (size: Size) => void
  onTextChange: (text: string) => void
  onInteractionStart?: (options?: NoteNodeInteractionOptions) => void
}

type ResizeAxis = 'horizontal' | 'vertical'

export function NoteNode({
  text,
  width,
  height,
  onClose,
  onResize,
  onTextChange,
  onInteractionStart,
}: NoteNodeProps): JSX.Element {
  const { t } = useTranslation()
  const resizeStartRef = useRef<{
    x: number
    y: number
    width: number
    height: number
    axis: ResizeAxis
  } | null>(null)
  const draftSizeRef = useRef<Size | null>(null)
  const [isResizing, setIsResizing] = useState(false)
  const [draftSize, setDraftSize] = useState<Size | null>(null)

  useEffect(() => {
    draftSizeRef.current = draftSize
  }, [draftSize])

  useEffect(() => {
    if (!draftSize || isResizing) {
      return
    }

    if (draftSize.width === width && draftSize.height === height) {
      setDraftSize(null)
    }
  }, [draftSize, height, isResizing, width])

  const handleResizePointerDown = useCallback(
    (axis: ResizeAxis) => (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.setPointerCapture(event.pointerId)

      resizeStartRef.current = {
        x: event.clientX,
        y: event.clientY,
        width,
        height,
        axis,
      }

      setDraftSize({ width, height })
      setIsResizing(true)
    },
    [height, width],
  )

  useEffect(() => {
    if (!isResizing) {
      return
    }

    const handlePointerMove = (event: PointerEvent) => {
      const start = resizeStartRef.current
      if (!start) {
        return
      }

      if (start.axis === 'horizontal') {
        const nextWidth = Math.max(320, Math.round(start.width + (event.clientX - start.x)))
        setDraftSize({ width: nextWidth, height: start.height })
        return
      }

      const nextHeight = Math.max(220, Math.round(start.height + (event.clientY - start.y)))
      setDraftSize({ width: start.width, height: nextHeight })
    }

    const handlePointerUp = () => {
      setIsResizing(false)

      const finalSize = draftSizeRef.current ?? { width, height }
      onResize(finalSize)

      resizeStartRef.current = null
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp, { once: true })

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [height, isResizing, onResize, width])

  const renderedSize = draftSize ?? { width, height }
  const style = useMemo(
    () => ({ width: renderedSize.width, height: renderedSize.height }),
    [renderedSize.height, renderedSize.width],
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

      <button
        type="button"
        className="task-node__resizer task-node__resizer--right nodrag"
        onPointerDown={handleResizePointerDown('horizontal')}
        aria-label={t('noteNode.resizeWidth')}
        data-testid="note-resizer-right"
      />
      <button
        type="button"
        className="task-node__resizer task-node__resizer--bottom nodrag"
        onPointerDown={handleResizePointerDown('vertical')}
        aria-label={t('noteNode.resizeHeight')}
        data-testid="note-resizer-bottom"
      />
    </div>
  )
}
