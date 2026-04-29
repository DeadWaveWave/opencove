import type { JSX, MutableRefObject } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { DocumentNodeUnsupportedKind, LoadedDocumentMediaSource } from './DocumentNode.shared'

export function DocumentNodeBody({
  isLoading,
  loadError,
  mediaLoadError,
  unsupportedKind,
  mediaSource,
  interactiveContentClassName,
  onRetry,
  saveError,
  lineNumberText,
  gutterRef,
  textareaRef,
  content,
  onContentChange,
  onSaveShortcut,
  onMediaError,
}: {
  isLoading: boolean
  loadError: string | null
  mediaLoadError: boolean
  unsupportedKind: DocumentNodeUnsupportedKind | null
  mediaSource: LoadedDocumentMediaSource | null
  interactiveContentClassName: string
  onRetry: () => void
  saveError: string | null
  lineNumberText: string
  gutterRef: MutableRefObject<HTMLPreElement | null>
  textareaRef: MutableRefObject<HTMLTextAreaElement | null>
  content: string
  onContentChange: (next: string) => void
  onSaveShortcut: () => void
  onMediaError: () => void
}): JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="document-node__body">
      {isLoading ? (
        <div className="document-node__state">{t('common.loading')}</div>
      ) : loadError ? (
        <div className="document-node__state document-node__state--error">
          <div className="document-node__state-title">{t('common.error')}</div>
          <div className="document-node__state-message">{loadError}</div>
          <button
            type="button"
            className="document-node__state-action nodrag"
            onPointerDown={event => {
              event.stopPropagation()
            }}
            onClick={event => {
              event.stopPropagation()
              onRetry()
            }}
          >
            {t('documentNode.retry')}
          </button>
        </div>
      ) : mediaLoadError ? (
        <div className="document-node__state document-node__state--warning">
          <div className="document-node__state-title">
            {t('documentNode.mediaUnsupportedTitle')}
          </div>
          <div className="document-node__state-message">
            {t('documentNode.mediaUnsupportedMessage')}
          </div>
        </div>
      ) : unsupportedKind ? (
        <div className="document-node__state document-node__state--warning">
          <div className="document-node__state-title">
            {unsupportedKind === 'binary'
              ? t('documentNode.binaryTitle')
              : t('documentNode.tooLargeTitle')}
          </div>
          <div className="document-node__state-message">
            {unsupportedKind === 'binary'
              ? t('documentNode.binaryMessage')
              : t('documentNode.tooLargeMessage')}
          </div>
        </div>
      ) : mediaSource ? (
        <div
          className={`document-node__media-shell document-node__media-shell--${mediaSource.kind} ${interactiveContentClassName}`}
          onPointerDownCapture={event => {
            event.stopPropagation()
          }}
        >
          {mediaSource.kind === 'audio' ? (
            <audio
              className="document-node__media document-node__media--audio nodrag"
              data-testid="document-node-audio"
              controls
              preload="metadata"
              src={mediaSource.url}
              onError={onMediaError}
            />
          ) : (
            <video
              className="document-node__media document-node__media--video nodrag"
              data-testid="document-node-video"
              controls
              preload="metadata"
              playsInline
              src={mediaSource.url}
              onError={onMediaError}
            />
          )}
        </div>
      ) : (
        <>
          {saveError ? (
            <div className="document-node__save-error" role="status">
              {saveError}
            </div>
          ) : null}
          <div
            className={`document-node__editor ${interactiveContentClassName}`}
            onPointerDownCapture={event => {
              event.stopPropagation()
            }}
          >
            <pre
              ref={gutterRef}
              className="document-node__gutter nodrag nowheel"
              aria-hidden="true"
            >
              {lineNumberText}
            </pre>
            <textarea
              ref={textareaRef}
              className="document-node__textarea nodrag nowheel"
              data-testid="document-node-textarea"
              value={content}
              spellCheck={false}
              onScroll={event => {
                const gutter = gutterRef.current
                if (gutter) {
                  gutter.scrollTop = event.currentTarget.scrollTop
                }
              }}
              onChange={event => {
                onContentChange(event.target.value)
              }}
              onKeyDown={event => {
                const isSaveShortcut =
                  event.key.toLowerCase() === 's' && (event.metaKey || event.ctrlKey)
                if (!isSaveShortcut) {
                  return
                }

                event.preventDefault()
                event.stopPropagation()
                onSaveShortcut()
              }}
            />
          </div>
        </>
      )}
    </div>
  )
}
