import React from 'react'
import { useStore } from '@xyflow/react'
import { GripHorizontal } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import { loadDocumentNodeContent } from '../../DocumentNode.helpers'
import type { WorkspaceCanvasQuickPreviewState } from '../types'
import { resolveCanvasImageMimeType } from '../hooks/useSpaceExplorer.helpers'
import { toErrorMessage } from '../helpers'
import { selectViewportTransform } from './WorkspaceSpaceExplorerOverlay.helpers'
import { resolveFilesystemApiForMount } from '../../../utils/mountAwareFilesystemApi'

type QuickPreviewContentState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'text'; content: string }
  | { kind: 'image'; url: string }
  | { kind: 'unsupported'; unsupportedKind: 'binary' | 'tooLarge' }

export function WorkspaceSpaceQuickPreview({
  preview,
  onOpen,
  onDragStart,
}: {
  preview: WorkspaceCanvasQuickPreviewState | null
  onOpen: () => void
  onDragStart: (event: React.MouseEvent<HTMLElement>) => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const transform = useStore(selectViewportTransform)
  const [contentState, setContentState] = React.useState<QuickPreviewContentState>({
    kind: 'loading',
  })
  const gutterRef = React.useRef<HTMLPreElement | null>(null)

  const pixelRect = React.useMemo(() => {
    if (!preview) {
      return null
    }

    const [translateX, translateY, zoom] = transform
    return {
      left: preview.rect.x * zoom + translateX,
      top: preview.rect.y * zoom + translateY,
      width: preview.rect.width * zoom,
      height: preview.rect.height * zoom,
    }
  }, [preview, transform])

  React.useEffect(() => {
    if (!preview) {
      return
    }

    const filesystemApi = resolveFilesystemApiForMount(preview.mountId)
    if (!filesystemApi) {
      setContentState({
        kind: 'error',
        message: t('documentNode.filesystemUnavailable'),
      })
      return
    }

    let cancelled = false
    let objectUrl: string | null = null

    setContentState({ kind: 'loading' })

    void (async () => {
      try {
        const mimeType = resolveCanvasImageMimeType(preview.uri)
        if (preview.kind === 'image' && mimeType && filesystemApi.readFileBytes) {
          const { bytes } = await filesystemApi.readFileBytes({ uri: preview.uri })
          if (cancelled) {
            return
          }

          const blobBytes = new Uint8Array(bytes)
          objectUrl = URL.createObjectURL(new Blob([blobBytes], { type: mimeType }))
          setContentState({ kind: 'image', url: objectUrl })
          return
        }

        const result = await loadDocumentNodeContent(
          filesystemApi,
          preview.uri,
          t('documentNode.notAFile'),
        )
        if (cancelled) {
          return
        }

        setContentState(result)
      } catch (error) {
        if (cancelled) {
          return
        }

        setContentState({
          kind: 'error',
          message: toErrorMessage(error),
        })
      }
    })()

    return () => {
      cancelled = true
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [preview, t])

  if (!preview || !pixelRect) {
    return null
  }

  const lineNumberText =
    contentState.kind === 'text'
      ? (() => {
          const lineCount = Math.max(1, contentState.content.split('\n').length)
          let buffer = ''
          for (let line = 1; line <= lineCount; line += 1) {
            buffer += line === lineCount ? `${line}` : `${line}\n`
          }
          return buffer
        })()
      : ''

  const content =
    contentState.kind === 'loading' ? (
      <div className="workspace-space-quick-preview__state">{t('common.loading')}</div>
    ) : contentState.kind === 'error' ? (
      <div className="workspace-space-quick-preview__state workspace-space-quick-preview__state--error">
        <div className="workspace-space-quick-preview__state-title">{t('common.error')}</div>
        <div className="workspace-space-quick-preview__state-message">{contentState.message}</div>
      </div>
    ) : contentState.kind === 'unsupported' ? (
      <div className="workspace-space-quick-preview__state workspace-space-quick-preview__state--warning">
        <div className="workspace-space-quick-preview__state-title">
          {contentState.unsupportedKind === 'binary'
            ? t('documentNode.binaryTitle')
            : t('documentNode.tooLargeTitle')}
        </div>
        <div className="workspace-space-quick-preview__state-message">
          {contentState.unsupportedKind === 'binary'
            ? t('documentNode.binaryMessage')
            : t('documentNode.tooLargeMessage')}
        </div>
      </div>
    ) : contentState.kind === 'image' ? (
      <div className="workspace-space-quick-preview__image-shell">
        <img
          className="workspace-space-quick-preview__image"
          src={contentState.url}
          alt={preview.title}
          draggable={false}
        />
      </div>
    ) : (
      <div className="workspace-space-quick-preview__text-shell">
        <pre
          ref={gutterRef}
          className="workspace-space-quick-preview__gutter"
          data-testid="workspace-space-quick-preview-gutter"
          aria-hidden="true"
        >
          {lineNumberText}
        </pre>
        <pre
          className="workspace-space-quick-preview__text"
          data-testid="workspace-space-quick-preview-text"
          onScroll={event => {
            const gutter = gutterRef.current
            if (gutter) {
              gutter.scrollTop = event.currentTarget.scrollTop
            }
          }}
        >
          {contentState.content}
        </pre>
      </div>
    )

  return (
    <section
      className="workspace-space-quick-preview"
      data-testid="workspace-space-quick-preview"
      data-preview-kind={preview.kind}
      style={pixelRect}
      onDoubleClick={event => {
        event.stopPropagation()
        onOpen()
      }}
      onPointerDown={event => {
        event.stopPropagation()
      }}
      onClick={event => {
        event.stopPropagation()
      }}
    >
      <header className="workspace-space-quick-preview__header">
        <div
          className="workspace-space-quick-preview__drag-handle"
          onMouseDown={event => {
            onDragStart(event)
          }}
          onClick={event => {
            event.preventDefault()
            event.stopPropagation()
          }}
        >
          <GripHorizontal size={14} aria-hidden="true" />
          <span>{preview.title}</span>
        </div>
      </header>

      <div className="workspace-space-quick-preview__body">{content}</div>
    </section>
  )
}
