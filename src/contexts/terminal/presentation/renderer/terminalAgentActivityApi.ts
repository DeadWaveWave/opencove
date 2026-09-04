import type { ControlSurfaceInvokeRequest } from '../../../../shared/contracts/controlSurface'
import type {
  ListTerminalAgentActivityMetadataResult,
  TerminalAgentActivityMetadata,
} from '../../../../shared/contracts/dto'
import { normalizeTerminalAgentActivityMetadata } from '../../../../shared/runtime/terminalAgentActivity'

export interface TerminalAgentActivityApi {
  listLatestMetadata: () => Promise<readonly TerminalAgentActivityMetadata[]>
}

type InvokeControlSurface = (request: ControlSurfaceInvokeRequest) => Promise<unknown>

function invalidBaseline(): Error {
  return new Error('Invalid terminal Agent activity baseline result.')
}

export function parseTerminalAgentActivityMetadataResult(
  value: unknown,
): ListTerminalAgentActivityMetadataResult {
  if (
    !value ||
    typeof value !== 'object' ||
    !Array.isArray((value as { entries?: unknown }).entries)
  ) {
    throw invalidBaseline()
  }
  const entries: TerminalAgentActivityMetadata[] = []
  const sessionIds = new Set<string>()
  for (const rawEntry of (value as { entries: unknown[] }).entries) {
    const entry = normalizeTerminalAgentActivityMetadata(rawEntry)
    if (!entry || sessionIds.has(entry.sessionId)) {
      throw invalidBaseline()
    }
    sessionIds.add(entry.sessionId)
    entries.push(entry)
  }
  return { entries }
}

export function createTerminalAgentActivityApi(
  options: { invoke?: InvokeControlSurface } = {},
): TerminalAgentActivityApi {
  const invoke =
    options.invoke ??
    (async request => await window.opencoveApi.controlSurface.invoke<unknown>(request))
  return {
    listLatestMetadata: async () => {
      const value = await invoke({
        kind: 'query',
        id: 'session.terminalAgentActivity.list',
        payload: null,
      })
      return parseTerminalAgentActivityMetadataResult(value).entries
    },
  }
}
