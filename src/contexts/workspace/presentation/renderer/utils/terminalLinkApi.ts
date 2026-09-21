import type { TerminalLinkStatPort } from '@contexts/terminal/application/links/resolveTerminalLinkTarget'
import type {
  TerminalLinkFileReference,
  TerminalResolvedFileTarget,
} from '@contexts/terminal/domain/links/terminalLinkTarget'
import { toAppErrorDescriptor } from '@shared/errors/appError'

/** Transport adapter: a remote identity never falls back to the local filesystem. */
export const statTerminalLink: TerminalLinkStatPort = async ({ uri, mountId, endpointId }) => {
  try {
    if (mountId) {
      if (!window.opencoveApi.controlSurface) {
        return { reason: 'unavailable' }
      }
      return await window.opencoveApi.controlSurface.invoke({
        kind: 'query',
        id: 'filesystem.statInMount',
        payload: { mountId, uri },
      })
    }
    if (endpointId && endpointId !== 'local') {
      return { reason: 'unavailable' }
    }
    return await window.opencoveApi.filesystem.stat({ uri })
  } catch (error) {
    const descriptor = toAppErrorDescriptor(error)
    const reason = descriptor.params?.reason
    if (reason === 'not_found' || reason === 'forbidden' || reason === 'unavailable') {
      return { reason }
    }
    if (descriptor.code === 'common.approved_path_required') {
      return { reason: 'forbidden' }
    }
    return { reason: 'unavailable' }
  }
}

export function openTerminalUrl(uri: string): void {
  const parsed = new URL(uri)
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return
  }
  window.open(uri, '_blank', 'noopener,noreferrer')
}

export async function getTerminalSystemOpenCapability(): Promise<boolean> {
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

export function canOpenTerminalTargetWithSystem(
  reference: TerminalLinkFileReference,
  hasLocalSystemAccess = false,
): boolean {
  const isLocal =
    reference.endpointId === 'local' ||
    (reference.endpointId === undefined && reference.mountId === undefined)
  return (
    hasLocalSystemAccess &&
    isLocal &&
    window.opencoveApi?.meta?.runtime === 'electron' &&
    typeof window.opencoveApi.workspace?.openPath === 'function'
  )
}

export async function openTerminalTargetWithSystem(
  target: TerminalResolvedFileTarget,
  hasLocalSystemAccess = false,
): Promise<boolean> {
  if (!canOpenTerminalTargetWithSystem(target, hasLocalSystemAccess)) {
    return false
  }
  // Main retains the approved-path guard; a terminal link grants no new filesystem authority.
  await window.opencoveApi.workspace.openPath({ path: target.path, openerId: 'finder' })
  return true
}

export async function copyTerminalLink(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}

export async function getTerminalLinkEnvironment(
  endpointId: string,
): Promise<{ platform: 'windows' | 'posix'; home: string; hostname?: string } | null> {
  try {
    const result = await window.opencoveApi.controlSurface.invoke({
      kind: 'query',
      id: 'endpoint.homeDirectory',
      payload: { endpointId },
    })
    if (!['win32', 'darwin', 'linux'].includes(result.platform)) {
      return null
    }
    return {
      platform: result.platform === 'win32' ? 'windows' : 'posix',
      home: result.homeDirectory,
      hostname: result.hostname,
    }
  } catch {
    return null
  }
}
