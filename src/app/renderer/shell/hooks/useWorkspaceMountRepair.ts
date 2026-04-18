import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  WorkspaceSpaceState,
  WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import type { CreateMountResult, ListMountsResult } from '@shared/contracts/dto'
import { isAbsolutePath, normalizeSlashes } from '../utils/pathHelpers'
import { notifyTopologyChanged } from '../utils/topologyEvents'
import { useAppStore } from '../store/useAppStore'

function isAllocateProjectPlaceholderPath(workspacePath: string, workspaceId: string): boolean {
  const normalized = normalizeSlashes(workspacePath.trim()).replace(/\/+$/, '')
  if (normalized.length === 0) {
    return false
  }

  const segments = normalized.split('/').filter(Boolean)
  if (segments.length < 2) {
    return false
  }

  const last = segments[segments.length - 1]
  const parent = segments[segments.length - 2]
  return last === workspaceId && parent === 'projects'
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>(resolve => {
    window.setTimeout(resolve, ms)
  })
}

async function retryUntil<T>(options: {
  timeoutMs: number
  intervalMs: number
  isCancelled: () => boolean
  fn: () => Promise<T>
}): Promise<T | null> {
  const startedAt = Date.now()

  const attempt = async (): Promise<T | null> => {
    if (options.isCancelled()) {
      return null
    }

    if (Date.now() - startedAt >= options.timeoutMs) {
      return null
    }

    try {
      return await options.fn()
    } catch {
      await delay(options.intervalMs)
      return await attempt()
    }
  }

  return await attempt()
}

async function waitForControlSurfaceReady(options?: { timeoutMs?: number }): Promise<boolean> {
  const invoke = (window as unknown as { opencoveApi?: { controlSurface?: { invoke?: unknown } } })
    .opencoveApi?.controlSurface?.invoke

  if (typeof invoke !== 'function') {
    return false
  }

  const timeoutMs = options?.timeoutMs ?? 15_000
  const startedAt = Date.now()
  const poll = async (): Promise<boolean> => {
    if (Date.now() - startedAt >= timeoutMs) {
      return false
    }

    try {
      await window.opencoveApi.controlSurface.invoke({
        kind: 'query',
        id: 'system.ping',
        payload: null,
      })
      return true
    } catch {
      await delay(250)
      return await poll()
    }
  }

  return await poll()
}

function normalizeComparablePath(value: string, options?: { lowercase?: boolean }): string {
  const normalized = normalizeSlashes(value.trim()).replace(/\/+$/, '')
  return options?.lowercase ? normalized.toLowerCase() : normalized
}

function isPathWithinRoot(
  rootPath: string,
  candidatePath: string,
  options?: { lowercase?: boolean },
) {
  const root = normalizeComparablePath(rootPath, options)
  const candidate = normalizeComparablePath(candidatePath, options)
  if (root.length === 0 || candidate.length === 0) {
    return false
  }

  if (root === candidate) {
    return true
  }

  if (!candidate.startsWith(root)) {
    return false
  }

  const boundary = candidate[root.length]
  return boundary === '/'
}

function resolveMountIdForSpace(options: {
  directoryPath: string
  mounts: ListMountsResult['mounts']
  lowercase?: boolean
}): string {
  if (options.mounts.length === 0) {
    return ''
  }

  const directoryPath = options.directoryPath.trim()
  if (directoryPath.length === 0) {
    return options.mounts[0].mountId
  }

  let best: { mountId: string; rootPathLength: number } | null = null
  for (const mount of options.mounts) {
    if (!isPathWithinRoot(mount.rootPath, directoryPath, { lowercase: options.lowercase })) {
      continue
    }

    const length = normalizeComparablePath(mount.rootPath, { lowercase: options.lowercase }).length
    if (!best || length > best.rootPathLength) {
      best = { mountId: mount.mountId, rootPathLength: length }
    }
  }

  return best?.mountId ?? options.mounts[0].mountId
}

export function useWorkspaceMountRepair({
  enabled,
  workspaces,
  requestPersistFlush,
}: {
  enabled: boolean
  workspaces: WorkspaceState[]
  requestPersistFlush?: () => void
}): void {
  const [topologyRevision, setTopologyRevision] = useState(0)
  const [repairKick, setRepairKick] = useState(0)

  useEffect(() => {
    const handler = () => {
      setTopologyRevision(previous => previous + 1)
    }

    window.addEventListener('opencove:topology-changed', handler)
    return () => {
      window.removeEventListener('opencove:topology-changed', handler)
    }
  }, [])

  const workspaceKey = useMemo(
    () => workspaces.map(workspace => workspace.id).join('|'),
    [workspaces],
  )
  const repairKey = useMemo(
    () => `${workspaceKey}::${String(topologyRevision)}::${String(repairKick)}`,
    [repairKick, topologyRevision, workspaceKey],
  )
  const lastRepairedKeyRef = useRef<string | null>(null)
  const runningRef = useRef(false)
  const runningKeyRef = useRef<string | null>(null)
  const rerunRequestedRef = useRef(false)

  useEffect(() => {
    if (!enabled) {
      return
    }

    if (runningRef.current) {
      if (runningKeyRef.current !== repairKey) {
        rerunRequestedRef.current = true
      }
      return
    }

    if (lastRepairedKeyRef.current === repairKey) {
      return
    }

    const controlSurfaceInvoke = (
      window as unknown as { opencoveApi?: { controlSurface?: { invoke?: unknown } } }
    ).opencoveApi?.controlSurface?.invoke

    if (typeof controlSurfaceInvoke !== 'function') {
      return
    }

    const runKey = repairKey
    runningRef.current = true
    runningKeyRef.current = runKey
    let cancelled = false
    let repairCompleted = false

    void (async () => {
      const ready = await waitForControlSurfaceReady({ timeoutMs: 60_000 })
      if (!ready || cancelled) {
        return
      }

      const lowercase = window.opencoveApi?.meta?.platform === 'win32'
      let didCreateMount = false
      const repairedSpacesByWorkspaceId = new Map<string, WorkspaceSpaceState[]>()

      await workspaces.reduce<Promise<void>>((acc, workspace) => {
        return acc.then(async () => {
          if (cancelled) {
            return
          }

          const rootPath = workspace.path.trim()
          if (rootPath.length === 0 || !isAbsolutePath(rootPath)) {
            return
          }

          let mountResult = await retryUntil<ListMountsResult>({
            timeoutMs: 30_000,
            intervalMs: 250,
            isCancelled: () => cancelled,
            fn: async () =>
              await window.opencoveApi.controlSurface.invoke<ListMountsResult>({
                kind: 'query',
                id: 'mount.list',
                payload: { projectId: workspace.id },
              }),
          })

          if (!mountResult) {
            return
          }

          if (mountResult.mounts.length === 0) {
            if (isAllocateProjectPlaceholderPath(rootPath, workspace.id)) {
              return
            }

            const createdMountResult = await retryUntil<CreateMountResult>({
              timeoutMs: 30_000,
              intervalMs: 500,
              isCancelled: () => cancelled,
              fn: async () =>
                await window.opencoveApi.controlSurface.invoke<CreateMountResult>({
                  kind: 'command',
                  id: 'mount.create',
                  payload: {
                    projectId: workspace.id,
                    endpointId: 'local',
                    rootPath,
                    name: workspace.name.trim().length > 0 ? workspace.name.trim() : null,
                  },
                }),
            })

            if (!createdMountResult) {
              return
            }

            didCreateMount = true
            mountResult = { projectId: workspace.id, mounts: [createdMountResult.mount] }
          }

          if (mountResult.mounts.length === 0) {
            return
          }

          const mountIds = new Set(mountResult.mounts.map(mount => mount.mountId))
          const placeholderPath = isAllocateProjectPlaceholderPath(rootPath, workspace.id)

          const repairedSpaces = workspace.spaces.map(space => {
            const shouldRepairMount =
              !space.targetMountId || !mountIds.has(space.targetMountId.trim())

            if (!shouldRepairMount && !placeholderPath) {
              return space
            }

            const mountId = resolveMountIdForSpace({
              directoryPath: space.directoryPath,
              mounts: mountResult.mounts,
              lowercase,
            })

            let directoryPath = space.directoryPath
            if (directoryPath.trim().length === 0) {
              const mount = mountResult.mounts.find(item => item.mountId === mountId) ?? null
              directoryPath = mount?.rootPath ?? directoryPath
            } else if (
              placeholderPath &&
              normalizeComparablePath(directoryPath, { lowercase }) ===
                normalizeComparablePath(rootPath, { lowercase })
            ) {
              const mount = mountResult.mounts.find(item => item.mountId === mountId) ?? null
              directoryPath = mount?.rootPath ?? directoryPath
            }

            const nextTargetMountId = mountId.length > 0 ? mountId : (space.targetMountId ?? null)
            const normalizedTargetMountId =
              nextTargetMountId && nextTargetMountId.trim().length > 0
                ? nextTargetMountId.trim()
                : null

            if (
              normalizedTargetMountId === space.targetMountId &&
              directoryPath === space.directoryPath
            ) {
              return space
            }

            return {
              ...space,
              targetMountId: normalizedTargetMountId,
              directoryPath,
            }
          })

          const didRepairSpaces = repairedSpaces.some(
            (space, index) => space !== workspace.spaces[index],
          )
          if (didRepairSpaces) {
            repairedSpacesByWorkspaceId.set(workspace.id, repairedSpaces)
          }
        })
      }, Promise.resolve())

      if (!cancelled && didCreateMount) {
        notifyTopologyChanged()
      }

      if (!cancelled && repairedSpacesByWorkspaceId.size > 0) {
        useAppStore.getState().setWorkspaces(previous =>
          previous.map(workspace => {
            const nextSpaces = repairedSpacesByWorkspaceId.get(workspace.id)
            return nextSpaces ? { ...workspace, spaces: nextSpaces } : workspace
          }),
        )
        requestPersistFlush?.()
      }

      repairCompleted = true
    })()
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled && repairCompleted) {
          lastRepairedKeyRef.current = runKey
        }
        runningRef.current = false
        runningKeyRef.current = null

        if (!cancelled && rerunRequestedRef.current) {
          rerunRequestedRef.current = false
          setRepairKick(previous => previous + 1)
        }
      })

    return () => {
      cancelled = true
      runningRef.current = false
      runningKeyRef.current = null
    }
  }, [enabled, repairKey, requestPersistFlush, workspaces])
}
