import { useCallback, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { toErrorMessage } from '@app/renderer/shell/utils/format'
import type { NodeFrame, Point } from '../types'
import type { LabelColor, NodeLabelColorOverride } from '@shared/types/labelColor'
import { NodeResizeHandles } from './shared/NodeResizeHandles'
import { useNodeFrameResize } from '../utils/nodeFrameResize'
import { shouldStopWheelPropagation } from './taskNode/helpers'
import { resolveCanonicalNodeMinSize } from '../utils/workspaceNodeSizing'
import { normalizeMarkdownFileName } from './NoteNode.markdown'
import { InlineNodeTitleEditor } from './shared/InlineNodeTitleEditor'
import { NoteNodeActionsMenu } from './NoteNodeActionsMenu'

interface NoteNodeInteractionOptions {
  normalizeViewport?: boolean
  selectNode?: boolean
  clearSelection?: boolean
  shiftKey?: boolean
}

interface NoteNodeProps {
  title: string
  text: string
  labelColor?: LabelColor | null
  labelColorOverride?: NodeLabelColorOverride
  position: Point
  width: number
  height: number
  onShowMessage?: (message: string, tone?: 'info' | 'warning' | 'error') => void
  onClose: () => void
  onResize: (frame: NodeFrame) => void
  onTitleChange: (title: string) => void
  onTextChange: (text: string) => void
  onConvertToTask: () => void
  onSetLabelColorOverride: (labelColorOverride: NodeLabelColorOverride) => void
  onInteractionStart?: (options?: NoteNodeInteractionOptions) => void
}

export function NoteNode({
  title,
  text,
  labelColor,
  labelColorOverride = null,
  position,
  width,
  height,
  onShowMessage,
  onClose,
  onResize,
  onTitleChange,
  onTextChange,
  onConvertToTask,
  onSetLabelColorOverride,
  onInteractionStart,
}: NoteNodeProps): JSX.Element {
  const { t } = useTranslation()
  const [isSavingMarkdown, setIsSavingMarkdown] = useState(false)
  const resolvedTitle = title.trim().length > 0 ? title : ''
  const { draftFrame, handleResizePointerDown } = useNodeFrameResize({
    position,
    width,
    height,
    minSize: resolveCanonicalNodeMinSize('note'),
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

  const saveMarkdown = useCallback(async (): Promise<void> => {
    const fileName =
      normalizeMarkdownFileName(resolvedTitle) ??
      normalizeMarkdownFileName(t('noteNode.defaultFileName')) ??
      'note.md'

    setIsSavingMarkdown(true)

    try {
      const result = await window.opencoveApi.system.saveTextToDownloads({
        fileName,
        content: text,
      })
      if (result.status === 'canceled') {
        return
      }

      const messageKey =
        result.status === 'download-started'
          ? 'messages.noteMarkdownDownloadStarted'
          : 'messages.noteMarkdownSaved'
      onShowMessage?.(t(messageKey, { fileName: result.fileName }))
    } catch (error) {
      onShowMessage?.(
        t('messages.noteMarkdownDownloadFailed', { message: toErrorMessage(error) }),
        'error',
      )
    } finally {
      setIsSavingMarkdown(false)
    }
  }, [onShowMessage, resolvedTitle, t, text])

  const canConvertToTask = text.trim().length > 0

  return (
    <div
      className="note-node nowheel"
      style={style}
      onClickCapture={event => {
        if (event.button !== 0) {
          return
        }

        const targetElement =
          event.target instanceof Element
            ? event.target
            : event.target instanceof Node
              ? event.target.parentElement
              : null
        if (!targetElement) {
          return
        }

        if (targetElement.closest('.note-node__textarea')) {
          event.stopPropagation()
          onInteractionStart?.({
            normalizeViewport: true,
            clearSelection: true,
            selectNode: false,
            shiftKey: event.shiftKey,
          })
          return
        }

        if (targetElement.closest('.nodrag')) {
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
        {labelColor ? (
          <span
            className="cove-label-dot cove-label-dot--solid"
            data-cove-label-color={labelColor}
            aria-hidden="true"
          />
        ) : null}
        <InlineNodeTitleEditor
          value={resolvedTitle}
          placeholder={t('noteNode.untitledTitle')}
          ariaLabel={t('noteNode.titleInputLabel')}
          classNamePrefix="note-node"
          rootTestId="note-node-title"
          displayTestId="note-node-title-display"
          inputTestId="note-node-title-input"
          onCommit={onTitleChange}
        />
        <div
          className="note-node__header-drag-surface"
          data-testid="note-node-header-drag-surface"
          aria-hidden="true"
        />
        <NoteNodeActionsMenu
          isSavingMarkdown={isSavingMarkdown}
          canConvertToTask={canConvertToTask}
          labelColorOverride={labelColorOverride}
          onSaveMarkdown={saveMarkdown}
          onConvertToTask={onConvertToTask}
          onSetLabelColorOverride={onSetLabelColorOverride}
        />
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
