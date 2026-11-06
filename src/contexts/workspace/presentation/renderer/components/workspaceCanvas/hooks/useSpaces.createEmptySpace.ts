import { useCallback, useLayoutEffect, useMemo } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { useWorkspaceCanvasCreateSpace } from './useSpaces.createSpace'
import type { WorkspaceSpaceRect, WorkspaceSpaceState } from '../../../types'
import { sanitizeSpaces } from '../helpers'
import {
  createTopLevelSpaceRecord,
  emptySpaceSize,
} from '@contexts/workspace/domain/workspaceBootstrap'
import { resolveNodesPlacement } from './useNodesStore.resolvePlacement'
import { resolveSpaceMountLaunchContext } from './spaceMountLaunchContext'

type Options = Pick<
  Parameters<typeof useWorkspaceCanvasCreateSpace>[0],
  | 'workspaceId'
  | 'workspacePath'
  | 'standardWindowSizeBucket'
  | 'nodesRef'
  | 'spacesRef'
  | 'onSpacesChange'
  | 'onRequestPersistFlush'
  | 'setContextMenu'
  | 'setEmptySelectionPrompt'
  | 'setSpaceTargetMountPicker'
  | 'cancelSpaceRename'
  | 'onShowMessage'
> & { resolveDefaultSpaceName: () => string }

export function useCreateEmptySpace({
  workspaceId,
  workspacePath,
  standardWindowSizeBucket,
  nodesRef,
  spacesRef,
  onSpacesChange,
  onRequestPersistFlush,
  setContextMenu,
  setEmptySelectionPrompt,
  setSpaceTargetMountPicker,
  cancelSpaceRename,
  onShowMessage,
  resolveDefaultSpaceName,
}: Options) {
  const { t } = useTranslation()
  const lifetime = useMemo(
    () => ({ workspaceId, workspacePath, active: true }),
    [workspaceId, workspacePath],
  )
  useLayoutEffect(() => {
    lifetime.active = true
    return () => {
      lifetime.active = false
    }
  }, [lifetime])

  return useCallback(
    async (point: { x: number; y: number }): Promise<string | null> => {
      let context: Awaited<ReturnType<typeof resolveSpaceMountLaunchContext>>
      try {
        context = await resolveSpaceMountLaunchContext({
          workspaceId,
          workspacePath,
          space: null,
          spaces: [],
          fallbackToFirstMount: true,
        })
      } catch (error) {
        if (lifetime.active) {
          const message = error instanceof Error ? error.message : String(error)
          onShowMessage?.(t('messages.mountListFailed', { message }), 'error')
        }
        return null
      }
      if (!lifetime.active) {
        return null
      }
      if (!context.mountId) {
        onShowMessage?.(t('messages.projectHasNoMounts'), 'warning')
        return null
      }
      const nextSpaceId = crypto.randomUUID()
      const normalizedName = resolveDefaultSpaceName()

      const size = emptySpaceSize(standardWindowSizeBucket)

      const desiredAnchor = {
        x: Math.round(point.x - size.width / 2),
        y: Math.round(point.y - size.height / 2),
      }

      const resolved = resolveNodesPlacement({
        anchor: desiredAnchor,
        size,
        getNodes: () => nodesRef.current,
        getSpaceRects: () =>
          spacesRef.current
            .map(space => space.rect)
            .filter(
              (rect): rect is { x: number; y: number; width: number; height: number } =>
                rect !== null,
            ),
      })

      if (resolved.canPlace !== true) {
        onShowMessage?.(t('messages.noWindowSlotNearby'), 'warning')
        setContextMenu(null)
        setEmptySelectionPrompt(null)
        cancelSpaceRename()
        return null
      }

      const rect: WorkspaceSpaceRect = {
        x: Math.round(resolved.placement.x),
        y: Math.round(resolved.placement.y),
        width: size.width,
        height: size.height,
      }

      const nextSpace: WorkspaceSpaceState = createTopLevelSpaceRecord({
        id: nextSpaceId,
        name: normalizedName,
        directoryPath: context.workingDirectory,
        targetMountId: context.mountId,
        rect,
      })

      const nextSpaces = sanitizeSpaces([...spacesRef.current, nextSpace])
      spacesRef.current = nextSpaces
      onSpacesChange(nextSpaces)
      onRequestPersistFlush?.()
      setContextMenu(null)
      setEmptySelectionPrompt(null)
      setSpaceTargetMountPicker(null)
      cancelSpaceRename()
      return nextSpaceId
    },
    [
      cancelSpaceRename,
      nodesRef,
      lifetime,
      onRequestPersistFlush,
      onShowMessage,
      onSpacesChange,
      resolveDefaultSpaceName,
      setContextMenu,
      setEmptySelectionPrompt,
      setSpaceTargetMountPicker,
      spacesRef,
      standardWindowSizeBucket,
      workspaceId,
      workspacePath,
      t,
    ],
  )
}
