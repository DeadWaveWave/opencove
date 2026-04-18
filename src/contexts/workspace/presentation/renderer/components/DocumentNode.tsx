import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { toErrorMessage } from '@app/renderer/shell/utils/format'
import { NodeResizeHandles } from './shared/NodeResizeHandles'
import { useNodeFrameResize } from '../utils/nodeFrameResize'
import { resolveCanonicalNodeMinSize } from '../utils/workspaceNodeSizing'
import { shouldStopWheelPropagation } from './taskNode/helpers'
import { suppressExplorerOverlayInteractions } from './workspaceCanvas/explorerInteractionGuard'
import {
  decodeUriPathname,
  loadDocumentNodeContent,
  type DocumentNodeProps,
} from './DocumentNode.helpers'
import { resolveFilesystemApiForMount } from '../utils/mountAwareFilesystemApi'

export function DocumentNode({
  title,
  uri,
  mountId,
  labelColor,
  position,
  width,
  height,
  onClose,
  onResize,
  onInteractionStart,
}: DocumentNodeProps): JSX.Element {
  const { t } = useTranslation()
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [unsupportedKind, setUnsupportedKind] = useState<'binary' | 'tooLarge' | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [closePromptOpen, setClosePromptOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const gutterRef = useRef<HTMLPreElement | null>(null)
  const closeIntentRef = useRef(false)

  const isDirty = content !== savedContent

  const displayPath = useMemo(() => decodeUriPathname(uri), [uri])

  const { draftFrame, handleResizePointerDown } = useNodeFrameResize({
    position,
    width,
    height,
    minSize: resolveCanonicalNodeMinSize('document'),
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

  useEffect(() => {
    setIsLoading(true)
    setLoadError(null)
    setUnsupportedKind(null)
    setSaveError(null)
    setClosePromptOpen(false)

    const filesystemApi = resolveFilesystemApiForMount(mountId)
    if (!filesystemApi) {
      setIsLoading(false)
      setLoadError(t('documentNode.filesystemUnavailable'))
      return
    }

    let cancelled = false
    void (async () => {
      try {
        const result = await loadDocumentNodeContent(filesystemApi, uri, t('documentNode.notAFile'))
        if (cancelled) {
          return
        }

        if (result.kind === 'unsupported') {
          setContent('')
          setSavedContent('')
          setUnsupportedKind(result.unsupportedKind)
          setIsLoading(false)
          return
        }

        setContent(result.content)
        setSavedContent(result.content)
        setIsLoading(false)
      } catch (error) {
        if (cancelled) {
          return
        }

        setIsLoading(false)
        setLoadError(toErrorMessage(error))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [mountId, reloadNonce, t, uri])

  const save = useCallback(async (): Promise<boolean> => {
    if (unsupportedKind) {
      return false
    }

    const filesystemApi = resolveFilesystemApiForMount(mountId)
    if (!filesystemApi) {
      setSaveError(t('documentNode.filesystemUnavailable'))
      return false
    }

    setIsSaving(true)
    setSaveError(null)

    try {
      await filesystemApi.writeFileText({ uri, content })
      setSavedContent(content)
      setIsSaving(false)
      return true
    } catch (error) {
      setIsSaving(false)
      setSaveError(toErrorMessage(error))
      return false
    }
  }, [content, mountId, t, unsupportedKind, uri])

  const discardChanges = (): void => {
    setContent(savedContent)
    setSaveError(null)
    setClosePromptOpen(false)
  }

  const lineNumberText = useMemo(() => {
    const lineCount = Math.max(1, content.split('\n').length)
    let buffer = ''
    for (let line = 1; line <= lineCount; line += 1) {
      buffer += line === lineCount ? `${line}` : `${line}\n`
    }
    return buffer
  }, [content])

  useEffect(() => {
    if (isLoading || loadError) {
      return
    }
    if (unsupportedKind) {
      return
    }
    if (!isDirty || isSaving) {
      return
    }
    if (saveError) {
      return
    }

    const handle = window.setTimeout(() => {
      void save()
    }, 650)

    return () => {
      window.clearTimeout(handle)
    }
  }, [content, isDirty, isLoading, isSaving, loadError, save, saveError, unsupportedKind])

  useEffect(() => {
    if (!closeIntentRef.current) {
      return
    }

    if (isSaving) {
      return
    }

    if (saveError) {
      closeIntentRef.current = false
      setClosePromptOpen(true)
      return
    }

    if (isDirty) {
      void save()
      return
    }

    closeIntentRef.current = false
    onClose()
  }, [isDirty, isSaving, onClose, save, saveError])

  const requestClose = (): void => {
    if (!isDirty && !isSaving) {
      onClose()
      return
    }

    closeIntentRef.current = true
    setClosePromptOpen(false)

    if (!isSaving && isDirty) {
      void save()
    }
  }

  const confirmCloseSave = async (): Promise<void> => {
    const ok = await save()
    if (ok) {
      onClose()
    }
  }

  const confirmCloseDiscard = (): void => {
    discardChanges()
    onClose()
  }

  return (
    <div
      className="document-node nowheel"
      style={style}
      onClickCapture={event => {
        if (event.button !== 0 || !(event.target instanceof Element)) {
          return
        }

        if (event.target.closest('.document-node__editor')) {
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
          <button
            type="button"
            className="document-node__action"
            onPointerDown={event => {
              event.stopPropagation()
            }}
            onClick={event => {
              event.stopPropagation()
              void save()
            }}
            disabled={!isDirty || isLoading || isSaving || !!unsupportedKind}
            aria-label={t('common.save')}
            title={t('common.save')}
          >
            {isSaving ? t('common.saving') : t('common.save')}
          </button>

          {isDirty ? (
            <button
              type="button"
              className="document-node__action document-node__action--secondary"
              onPointerDown={event => {
                event.stopPropagation()
              }}
              onClick={event => {
                event.stopPropagation()
                discardChanges()
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
              requestClose()
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
                void confirmCloseSave()
              }}
              disabled={isSaving}
            >
              {t('documentNode.saveAndClose')}
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
                confirmCloseDiscard()
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
                setClosePromptOpen(false)
              }}
              disabled={isSaving}
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : null}

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
                setReloadNonce(previous => previous + 1)
              }}
            >
              {t('documentNode.retry')}
            </button>
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
        ) : (
          <>
            {saveError ? (
              <div className="document-node__save-error" role="status">
                {saveError}
              </div>
            ) : null}
            <div
              className="document-node__editor"
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
                  setContent(event.target.value)
                  if (saveError) {
                    setSaveError(null)
                  }
                }}
                onKeyDown={event => {
                  const isSaveShortcut =
                    event.key.toLowerCase() === 's' && (event.metaKey || event.ctrlKey)
                  if (!isSaveShortcut) {
                    return
                  }

                  event.preventDefault()
                  event.stopPropagation()
                  void save()
                }}
              />
            </div>
          </>
        )}
      </div>

      <NodeResizeHandles
        classNamePrefix="task-node"
        testIdPrefix="document-resizer"
        handleResizePointerDown={handleResizePointerDown}
      />
    </div>
  )
}
