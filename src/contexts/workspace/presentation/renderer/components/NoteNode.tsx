import { useCallback, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { Download } from 'lucide-react'
import { toErrorMessage } from '@app/renderer/shell/utils/format'
import type { NodeFrame, Point } from '../types'
import type { LabelColor } from '@shared/types/labelColor'
import { NodeResizeHandles } from './shared/NodeResizeHandles'
import { useNodeFrameResize } from '../utils/nodeFrameResize'
import { shouldStopWheelPropagation } from './taskNode/helpers'
import { resolveCanonicalNodeMinSize } from '../utils/workspaceNodeSizing'
import { resolveFilesystemApiForMount } from '../utils/mountAwareFilesystemApi'
import { normalizeMarkdownFileName, saveNoteAsMarkdownFile } from './NoteNode.markdown'
import { InlineNodeTitleEditor } from './shared/InlineNodeTitleEditor'

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
  position: Point
  width: number
  height: number
  saveDirectoryPath: string
  saveMountId?: string | null
  onClose: () => void
  onResize: (frame: NodeFrame) => void
  onTitleChange: (title: string) => void
  onTextChange: (text: string) => void
  onInteractionStart?: (options?: NoteNodeInteractionOptions) => void
}

export function NoteNode({
  title,
  text,
  labelColor,
  position,
  width,
  height,
  saveDirectoryPath,
  saveMountId = null,
  onClose,
  onResize,
  onTitleChange,
  onTextChange,
  onInteractionStart,
}: NoteNodeProps): JSX.Element {
  const { t } = useTranslation()
  const [isSavingMarkdown, setIsSavingMarkdown] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedMarkdownPath, setSavedMarkdownPath] = useState<string | null>(null)
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
    const rawName = window.prompt(t('noteNode.saveMarkdownPrompt'), t('noteNode.defaultFileName'))
    if (rawName === null) {
      return
    }

    const fileName = normalizeMarkdownFileName(rawName)
    if (!fileName) {
      setSaveError(t('noteNode.invalidFileName'))
      setSavedMarkdownPath(null)
      return
    }

    const directoryPath = saveDirectoryPath.trim()
    if (!directoryPath) {
      setSaveError(t('documentNode.filesystemUnavailable'))
      setSavedMarkdownPath(null)
      return
    }

    const filesystemApi = resolveFilesystemApiForMount(saveMountId)
    if (!filesystemApi) {
      setSaveError(t('documentNode.filesystemUnavailable'))
      setSavedMarkdownPath(null)
      return
    }

    setIsSavingMarkdown(true)
    setSaveError(null)
    setSavedMarkdownPath(null)

    try {
      const targetPath = await saveNoteAsMarkdownFile({
        filesystemApi,
        directoryPath,
        fileName,
        text,
      })
      setSavedMarkdownPath(targetPath)
    } catch (error) {
      setSaveError(toErrorMessage(error))
    } finally {
      setIsSavingMarkdown(false)
    }
  }, [saveDirectoryPath, saveMountId, t, text])

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
        <button
          type="button"
          className="note-node__action nodrag"
          onPointerDown={event => {
            event.stopPropagation()
          }}
          onClick={event => {
            event.stopPropagation()
            void saveMarkdown()
          }}
          disabled={isSavingMarkdown}
          aria-label={t('noteNode.saveMarkdown')}
          title={t('noteNode.saveMarkdown')}
        >
          <Download aria-hidden="true" />
        </button>
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

      {saveError ? (
        <div className="note-node__save-status note-node__save-status--error" role="status">
          {saveError}
        </div>
      ) : null}
      {savedMarkdownPath ? (
        <div className="note-node__save-status" role="status">
          {t('noteNode.savedMarkdown', { path: savedMarkdownPath })}
        </div>
      ) : null}

      <NodeResizeHandles
        classNamePrefix="task-node"
        testIdPrefix="note-resizer"
        handleResizePointerDown={handleResizePointerDown}
      />
    </div>
  )
}
