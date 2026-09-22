import { fromFileUri } from '@contexts/filesystem/domain/fileUri'
import type { FileSystemStat, ResolveMountTargetResult } from '@shared/contracts/dto'

export interface SystemFileReference {
  uri: string
  mountId: string | null
}

interface SystemFileSource {
  endpointId?: string
  mountId?: string | null
}

export async function getSystemFileOpenCapability(): Promise<boolean> {
  if (window.opencoveApi?.meta?.runtime !== 'electron') {
    return false
  }
  try {
    const config = await window.opencoveApi.workerClient?.getConfig()
    return config?.mode === 'standalone' || config?.mode === 'local'
  } catch {
    return false
  }
}

export function canOpenSystemPath(source: SystemFileSource, hasLocalSystemAccess = false): boolean {
  const isLocal =
    source.endpointId === 'local' ||
    (source.endpointId === undefined && (source.mountId === undefined || source.mountId === null))
  return (
    hasLocalSystemAccess &&
    isLocal &&
    window.opencoveApi?.meta?.runtime === 'electron' &&
    typeof window.opencoveApi.workspace?.openPath === 'function'
  )
}

export async function openSystemPath(
  path: string,
  source: SystemFileSource,
  hasLocalSystemAccess = false,
): Promise<boolean> {
  if (!canOpenSystemPath(source, hasLocalSystemAccess)) {
    return false
  }
  // Main retains the approved-path guard; opening a file grants no new filesystem authority.
  await window.opencoveApi.workspace.openPath({ path, openerId: 'finder' })
  return true
}

async function resolveSystemFilePath(reference: SystemFileReference): Promise<string | null> {
  let path: string | null
  try {
    const parsed = new URL(reference.uri)
    if (
      parsed.protocol !== 'file:' ||
      parsed.search ||
      parsed.hash ||
      (parsed.host && window.opencoveApi?.meta?.platform !== 'win32')
    ) {
      return null
    }
    path = fromFileUri(reference.uri)
    if (!path || path.includes('\0')) {
      return null
    }
  } catch {
    return null
  }
  if (!(await getSystemFileOpenCapability())) {
    return null
  }
  if (reference.mountId !== null) {
    try {
      const target = await window.opencoveApi.controlSurface.invoke<ResolveMountTargetResult>({
        kind: 'query',
        id: 'mountTarget.resolve',
        payload: { mountId: reference.mountId },
      })
      if (target?.mountId !== reference.mountId || target.endpointId !== 'local') {
        return null
      }
    } catch {
      return null
    }
  }
  return canOpenSystemPath({ endpointId: 'local' }, true) ? path : null
}

export async function canOpenSystemFile(reference: SystemFileReference): Promise<boolean> {
  return (await resolveSystemFilePath(reference)) !== null
}

export async function openSystemFile(
  reference: SystemFileReference,
  isCurrent: () => boolean = () => true,
): Promise<boolean> {
  if (!isCurrent()) {
    return false
  }
  const path = await resolveSystemFilePath(reference)
  if (!path || !isCurrent()) {
    return false
  }
  const stat =
    reference.mountId !== null
      ? await window.opencoveApi.controlSurface.invoke<FileSystemStat>({
          kind: 'query',
          id: 'filesystem.statInMount',
          payload: reference,
        })
      : await window.opencoveApi.filesystem.stat({ uri: reference.uri })
  if (!isCurrent() || stat.kind !== 'file') {
    return false
  }
  return openSystemPath(path, { endpointId: 'local', mountId: reference.mountId }, true)
}
