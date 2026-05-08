import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { FileSystemStat } from '@shared/contracts/dto'
import { useTranslation } from '@app/renderer/i18n'
import { toErrorMessage } from '@app/renderer/shell/utils/format'
import { DocumentNodeChrome } from './DocumentNodeChrome'
import { createMediaObjectUrl } from './DocumentNode.media'
import type { DocumentNodeUnsupportedKind, LoadedDocumentMediaSource } from './DocumentNode.shared'
import {
  useDocumentNodeExternalRefresh,
  type DocumentNodeExternalRefreshState,
} from './useDocumentNodeExternalRefresh'
import {
  decodeUriPathname,
  loadDocumentNodeContent,
  type DocumentNodeLoadResult,
  type DocumentNodeProps,
} from './DocumentNode.helpers'
import { useNodeFrameResize } from '../utils/nodeFrameResize'
import { resolveFilesystemApiForMount } from '../utils/mountAwareFilesystemApi'
import { resolveCanonicalNodeMinSize } from '../utils/workspaceNodeSizing'

const DOCUMENT_NODE_AUTO_SAVE_DELAY_MS = 650
// Keep disk refresh ahead of auto-save so dirty drafts can enter conflict state
// before a background save overwrites an external change.
const DOCUMENT_NODE_EXTERNAL_REFRESH_INTERVAL_MS = 300

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
  const [loadError, setLoadError] = useState<string | null>(null)
  const [unsupportedKind, setUnsupportedKind] = useState<DocumentNodeUnsupportedKind | null>(null)
  const [mediaSource, setMediaSource] = useState<LoadedDocumentMediaSource | null>(null)
  const [mediaLoadError, setMediaLoadError] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [closePromptOpen, setClosePromptOpen] = useState(false)
  const [hasExternalConflict, setHasExternalConflict] = useState(false)
  const [lastKnownDiskStat, setLastKnownDiskStat] = useState<FileSystemStat | null>(null)
  const [externalConflictStat, setExternalConflictStat] = useState<FileSystemStat | null>(null)
  const closeIntentRef = useRef(false)
  const isMountedRef = useRef(true)
  const mediaObjectUrlRef = useRef<string | null>(null)

  const isDirty = content !== savedContent
  const displayPath = useMemo(() => decodeUriPathname(uri), [uri])
  const loadMessages = useMemo(
    () => ({
      notAFile: t('documentNode.notAFile'),
      binaryReadUnavailable: t('documentNode.binaryReadUnavailable'),
    }),
    [t],
  )

  const latestStateRef = useRef<DocumentNodeExternalRefreshState>({
    content,
    savedContent,
    isLoading,
    isSaving,
    loadError,
    unsupportedKind,
    mediaSource,
    mediaLoadError,
    lastKnownDiskStat,
    externalConflictStat,
  })

  latestStateRef.current = {
    content,
    savedContent,
    isLoading,
    isSaving,
    loadError,
    unsupportedKind,
    mediaSource,
    mediaLoadError,
    lastKnownDiskStat,
    externalConflictStat,
  }

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

  const revokeMediaObjectUrl = useCallback((): void => {
    if (!mediaObjectUrlRef.current) {
      return
    }

    URL.revokeObjectURL(mediaObjectUrlRef.current)
    mediaObjectUrlRef.current = null
  }, [])

  const applyLoadedResult = useCallback(
    (result: DocumentNodeLoadResult): void => {
      if (!isMountedRef.current) {
        return
      }

      setLoadError(null)
      setSaveError(null)
      setHasExternalConflict(false)
      setExternalConflictStat(null)
      setLastKnownDiskStat(result.stat)
      setClosePromptOpen(false)

      if (result.kind === 'unsupported') {
        revokeMediaObjectUrl()
        setContent('')
        setSavedContent('')
        setUnsupportedKind(result.unsupportedKind)
        setMediaSource(null)
        setMediaLoadError(false)
        return
      }

      if (result.kind === 'media') {
        revokeMediaObjectUrl()
        const objectUrl = createMediaObjectUrl(result.bytes, result.mimeType)
        mediaObjectUrlRef.current = objectUrl

        setContent('')
        setSavedContent('')
        setUnsupportedKind(null)
        setMediaSource({
          kind: result.mediaKind,
          mimeType: result.mimeType,
          url: objectUrl,
        })
        setMediaLoadError(false)
        return
      }

      revokeMediaObjectUrl()
      setUnsupportedKind(null)
      setMediaSource(null)
      setMediaLoadError(false)
      setContent(result.content)
      setSavedContent(result.content)
    },
    [revokeMediaObjectUrl],
  )

  const reloadFromDisk = useCallback(
    async (options?: { showLoading?: boolean }): Promise<boolean> => {
      const showLoading = options?.showLoading ?? false
      const filesystemApi = resolveFilesystemApiForMount(mountId)
      if (!filesystemApi) {
        if (isMountedRef.current) {
          setIsLoading(false)
          setLoadError(t('documentNode.filesystemUnavailable'))
        }
        return false
      }

      if (showLoading) {
        setIsLoading(true)
      }

      try {
        const result = await loadDocumentNodeContent(filesystemApi, uri, loadMessages)
        applyLoadedResult(result)
        return true
      } catch (error) {
        if (isMountedRef.current) {
          setLoadError(toErrorMessage(error))
        }
        return false
      } finally {
        if (showLoading && isMountedRef.current) {
          setIsLoading(false)
        }
      }
    },
    [applyLoadedResult, loadMessages, mountId, t, uri],
  )

  useEffect(() => {
    isMountedRef.current = true
    setIsLoading(true)
    setLoadError(null)
    setSaveError(null)
    setHasExternalConflict(false)
    setExternalConflictStat(null)
    setUnsupportedKind(null)
    setMediaSource(null)
    setMediaLoadError(false)

    void reloadFromDisk({ showLoading: true })

    return () => {
      isMountedRef.current = false
      revokeMediaObjectUrl()
    }
  }, [mountId, reloadFromDisk, revokeMediaObjectUrl, uri])

  const save = useCallback(
    async (options?: { overwrite?: boolean }): Promise<boolean> => {
      if (unsupportedKind || mediaSource || mediaLoadError) {
        return false
      }

      if (hasExternalConflict && options?.overwrite !== true) {
        setSaveError(t('documentNode.externalChangeSaveBlocked'))
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
        const stat = await filesystemApi.stat({ uri })

        setSavedContent(content)
        setLastKnownDiskStat(stat)
        setHasExternalConflict(false)
        setExternalConflictStat(null)
        setIsSaving(false)
        return true
      } catch (error) {
        setIsSaving(false)
        setSaveError(toErrorMessage(error))
        return false
      }
    },
    [content, hasExternalConflict, mediaLoadError, mediaSource, mountId, t, unsupportedKind, uri],
  )

  const discardChanges = useCallback(async (): Promise<boolean> => {
    if (hasExternalConflict) {
      return await reloadFromDisk()
    }

    setContent(savedContent)
    setSaveError(null)
    setClosePromptOpen(false)
    return true
  }, [hasExternalConflict, reloadFromDisk, savedContent])

  useEffect(() => {
    if (isLoading || loadError) {
      return
    }

    if (unsupportedKind || mediaSource || mediaLoadError) {
      return
    }

    if (!isDirty || isSaving || hasExternalConflict || saveError) {
      return
    }

    const handle = window.setTimeout(() => {
      void save()
    }, DOCUMENT_NODE_AUTO_SAVE_DELAY_MS)

    return () => {
      window.clearTimeout(handle)
    }
  }, [
    content,
    hasExternalConflict,
    isDirty,
    isLoading,
    isSaving,
    loadError,
    mediaLoadError,
    mediaSource,
    save,
    saveError,
    unsupportedKind,
  ])

  useDocumentNodeExternalRefresh({
    mountId,
    uri,
    intervalMs: DOCUMENT_NODE_EXTERNAL_REFRESH_INTERVAL_MS,
    isLoading,
    loadError,
    unsupportedKind,
    mediaSource,
    mediaLoadError,
    loadMessages,
    latestStateRef,
    applyLoadedResult,
    setHasExternalConflict,
    setExternalConflictStat,
  })

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
      void save({ overwrite: hasExternalConflict })
      return
    }

    closeIntentRef.current = false
    onClose()
  }, [hasExternalConflict, isDirty, isSaving, onClose, save, saveError])

  const requestClose = (): void => {
    if (!isDirty && !isSaving) {
      onClose()
      return
    }

    closeIntentRef.current = true
    setClosePromptOpen(false)

    if (!isSaving && isDirty) {
      void save({ overwrite: hasExternalConflict })
    }
  }

  const confirmCloseSave = async (): Promise<void> => {
    const ok = await save({ overwrite: hasExternalConflict })
    if (ok) {
      onClose()
    }
  }

  const confirmCloseDiscard = async (): Promise<void> => {
    const ok = await discardChanges()
    if (ok) {
      onClose()
    }
  }

  return (
    <DocumentNodeChrome
      title={title}
      uri={uri}
      displayPath={displayPath}
      labelColor={labelColor}
      style={style}
      isDirty={isDirty}
      isLoading={isLoading}
      isSaving={isSaving}
      loadError={loadError}
      mediaLoadError={mediaLoadError}
      unsupportedKind={unsupportedKind}
      mediaSource={mediaSource}
      hasExternalConflict={hasExternalConflict}
      saveError={saveError}
      content={content}
      onContentChange={nextContent => {
        setContent(nextContent)
        if (saveError) {
          setSaveError(null)
        }
      }}
      onRetry={() => {
        void reloadFromDisk({ showLoading: true })
      }}
      onReloadFromDisk={() => {
        void reloadFromDisk()
      }}
      onSaveShortcut={() => {
        if (hasExternalConflict) {
          setSaveError(t('documentNode.externalChangeSaveBlocked'))
          return
        }

        void save()
      }}
      onMediaError={() => {
        setMediaLoadError(true)
      }}
      onSave={() => {
        void save({ overwrite: hasExternalConflict })
      }}
      onDiscard={() => {
        void discardChanges()
      }}
      onRequestClose={requestClose}
      onConfirmCloseSave={() => {
        void confirmCloseSave()
      }}
      onConfirmCloseDiscard={() => {
        void confirmCloseDiscard()
      }}
      closePromptOpen={closePromptOpen}
      onClosePromptCancel={() => {
        setClosePromptOpen(false)
      }}
      handleResizePointerDown={handleResizePointerDown}
      onInteractionStart={onInteractionStart}
    />
  )
}
