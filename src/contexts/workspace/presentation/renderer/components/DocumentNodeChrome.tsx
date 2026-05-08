import type { CSSProperties, JSX } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { LabelColor } from '@shared/types/labelColor'
import { DocumentNodeBody } from './DocumentNodeBody'
import type { DocumentNodeInteractionOptions } from './DocumentNode.helpers'
import type { DocumentNodeUnsupportedKind, LoadedDocumentMediaSource } from './DocumentNode.shared'
import { NodeResizeHandles } from './shared/NodeResizeHandles'
import { shouldStopWheelPropagation } from './taskNode/helpers'
import { suppressExplorerOverlayInteractions } from './workspaceCanvas/explorerInteractionGuard'

export interface DocumentNodeChromeProps {
  title: string
  uri: string
  displayPath: string
  labelColor?: LabelColor | null
  style: CSSProperties
  isDirty: boolean
  isLoading: boolean
  isSaving: boolean
  loadError: string | null
  mediaLoadError: boolean
  unsupportedKind: DocumentNodeUnsupportedKind | null
  mediaSource: LoadedDocumentMediaSource | null
  hasExternalConflict: boolean
  saveError: string | null
  content: string
  onContentChange: (next: string) => void
  onRetry: () => void
  onReloadFromDisk: () => void
  onSaveShortcut: () => void
  onMediaError: () => void
  onSave: () => void
  onDiscard: () => void
  onRequestClose: () => void
  onConfirmCloseSave: () => void
  onConfirmCloseDiscard: () => void
  closePromptOpen: boolean
  onClosePromptCancel: () => void
  handleResizePointerDown: Parameters<typeof NodeResizeHandles>[0]['handleResizePointerDown']
  onInteractionStart?: (options?: DocumentNodeInteractionOptions) => void
}

export function DocumentNodeChrome({
  title,
  uri,
  displayPath,
  labelColor,
  style,
  isDirty,
  isLoading,
  isSaving,
  loadError,
  mediaLoadError,
  unsupportedKind,
  mediaSource,
  hasExternalConflict,
  saveError,
  content,
  onContentChange,
  onRetry,
  onReloadFromDisk,
  onSaveShortcut,
  onMediaError,
  onSave,
  onDiscard,
  onRequestClose,
  onConfirmCloseSave,
  onConfirmCloseDiscard,
  closePromptOpen,
  onClosePromptCancel,
  handleResizePointerDown,
  onInteractionStart,
}: DocumentNodeChromeProps): JSX.Element {
  const { t } = useTranslation()
  const showsEditorActions = !mediaSource && !unsupportedKind && !mediaLoadError
  const interactiveContentClassName = 'document-node__interactive'

  return (
    <div
      className="document-node nowheel"
      style={style}
      onClickCapture={event => {
        if (event.button !== 0 || !(event.target instanceof Element)) {
          return
        }

        if (event.target.closest(`.${interactiveContentClassName}`)) {
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
      <div className="document-node__header" data-node-drag-handle="true">
        {labelColor ? (
          <span
            className="cove-label-dot cove-label-dot--solid"
            data-cove-label-color={labelColor}
            aria-hidden="true"
          />
        ) : null}
        <span
          className="document-node__title"
          data-testid="document-node-title"
          title={displayPath}
        >
          {isDirty ? <span className="document-node__dirty-dot" aria-hidden="true" /> : null}
          <span className="document-node__title-text">{title}</span>
        </span>

        <div className="document-node__actions nodrag">
          {showsEditorActions ? (
            <button
              type="button"
              className="document-node__action"
              onPointerDown={event => {
                event.stopPropagation()
              }}
              onClick={event => {
                event.stopPropagation()
                onSave()
              }}
              disabled={!isDirty || isLoading || isSaving || !!unsupportedKind}
              aria-label={hasExternalConflict ? t('documentNode.overwrite') : t('common.save')}
              title={hasExternalConflict ? t('documentNode.overwrite') : t('common.save')}
            >
              {isSaving
                ? t('common.saving')
                : hasExternalConflict
                  ? t('documentNode.overwrite')
                  : t('common.save')}
            </button>
          ) : null}

          {showsEditorActions && isDirty ? (
            <button
              type="button"
              className="document-node__action document-node__action--secondary"
              onPointerDown={event => {
                event.stopPropagation()
              }}
              onClick={event => {
                event.stopPropagation()
                onDiscard()
              }}
              disabled={isLoading || isSaving || !!unsupportedKind}
              aria-label={t('documentNode.discard')}
              title={t('documentNode.discard')}
            >
              {t('documentNode.discard')}
            </button>
          ) : null}

          <button
            type="button"
            className="document-node__close nodrag"
            onPointerDown={event => {
              event.stopPropagation()
              suppressExplorerOverlayInteractions()
            }}
            onClick={event => {
              event.stopPropagation()
              onRequestClose()
            }}
            aria-label={t('documentNode.close')}
            title={t('documentNode.close')}
          >
            ×
          </button>
        </div>
      </div>

      {closePromptOpen ? (
        <div className="document-node__close-prompt nodrag" role="dialog">
          <span className="document-node__close-prompt-text">
            {t('documentNode.unsavedPrompt')}
          </span>
          <div className="document-node__close-prompt-actions">
            <button
              type="button"
              className="document-node__close-prompt-action"
              onPointerDown={event => {
                event.stopPropagation()
                suppressExplorerOverlayInteractions()
              }}
              onClick={event => {
                event.stopPropagation()
                onConfirmCloseSave()
              }}
              disabled={isSaving}
            >
              {hasExternalConflict
                ? t('documentNode.overwriteAndClose')
                : t('documentNode.saveAndClose')}
            </button>
            <button
              type="button"
              className="document-node__close-prompt-action document-node__close-prompt-action--secondary"
              onPointerDown={event => {
                event.stopPropagation()
                suppressExplorerOverlayInteractions()
              }}
              onClick={event => {
                event.stopPropagation()
                onConfirmCloseDiscard()
              }}
              disabled={isSaving}
            >
              {t('documentNode.discard')}
            </button>
            <button
              type="button"
              className="document-node__close-prompt-action document-node__close-prompt-action--ghost"
              onPointerDown={event => {
                event.stopPropagation()
              }}
              onClick={event => {
                event.stopPropagation()
                onClosePromptCancel()
              }}
              disabled={isSaving}
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : null}

      <DocumentNodeBody
        uri={uri}
        isLoading={isLoading}
        loadError={loadError}
        mediaLoadError={mediaLoadError}
        unsupportedKind={unsupportedKind}
        mediaSource={mediaSource}
        interactiveContentClassName={interactiveContentClassName}
        hasExternalConflict={hasExternalConflict}
        onRetry={onRetry}
        onReloadFromDisk={onReloadFromDisk}
        saveError={saveError}
        content={content}
        onContentChange={onContentChange}
        onSaveShortcut={onSaveShortcut}
        onMediaError={onMediaError}
      />

      <NodeResizeHandles
        classNamePrefix="task-node"
        testIdPrefix="document-resizer"
        handleResizePointerDown={handleResizePointerDown}
      />
    </div>
  )
}
