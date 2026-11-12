import type { TerminalLinkStatPort } from '@contexts/terminal/application/links/resolveTerminalLinkTarget'
import type {
  TerminalLinkFileReference,
  TerminalResolvedFileTarget,
} from '@contexts/terminal/domain/links/terminalLinkTarget'
import { toAppErrorDescriptor } from '@shared/errors/appError'
import { canOpenSystemPath, getSystemFileOpenCapability, openSystemPath } from './systemFileOpening'

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
  return getSystemFileOpenCapability()
}

export function canOpenTerminalTargetWithSystem(
  reference: TerminalLinkFileReference,
  hasLocalSystemAccess = false,
): boolean {
  return canOpenSystemPath(reference, hasLocalSystemAccess)
}

export async function openTerminalTargetWithSystem(
  target: TerminalResolvedFileTarget,
  hasLocalSystemAccess = false,
): Promise<boolean> {
  return openSystemPath(target.path, target, hasLocalSystemAccess)
}

export async function copyTerminalLink(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}

type TerminalLinkEnvironment = { platform: 'windows' | 'posix'; home: string; hostname?: string }

// An endpoint's home directory and platform do not change while the app runs, but every
// terminal mount asks for them. Keep successful lookups; failures are retried next time.
const terminalLinkEnvironmentCache = new Map<string, Promise<TerminalLinkEnvironment | null>>()

export async function getTerminalLinkEnvironment(
  endpointId: string,
): Promise<TerminalLinkEnvironment | null> {
  const cached = terminalLinkEnvironmentCache.get(endpointId)
  if (cached) {
    return await cached
  }
  const pending = fetchTerminalLinkEnvironment(endpointId)
  terminalLinkEnvironmentCache.set(endpointId, pending)
  const result = await pending
  if (!result && terminalLinkEnvironmentCache.get(endpointId) === pending) {
    terminalLinkEnvironmentCache.delete(endpointId)
  }
  return result
}

async function fetchTerminalLinkEnvironment(
  endpointId: string,
): Promise<TerminalLinkEnvironment | null> {
  try {
    const result = await window.opencoveApi.controlSurface.invoke<{
      platform: string
      homeDirectory: string
      hostname?: string
    }>({
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
