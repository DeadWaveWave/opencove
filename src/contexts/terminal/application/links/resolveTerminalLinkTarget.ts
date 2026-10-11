import {
  hasTerminalLinkControlCharacters,
  prepareTerminalLinkPath,
} from '../../domain/links/terminalLinkPath'
import type {
  TerminalLinkFileReference,
  TerminalLinkSourceContext,
  TerminalLinkTargetInput,
  TerminalLinkTargetResolution,
  TerminalResolvedFileTarget,
} from '../../domain/links/terminalLinkTarget'

export type { TerminalLinkSourceContext, TerminalLinkTargetInput, TerminalLinkTargetResolution }
export type { TerminalResolvedFileTarget } from '../../domain/links/terminalLinkTarget'

export type TerminalLinkStatResult =
  | { kind: 'file' | 'directory' | 'unknown' }
  | { reason: 'not_found' | 'forbidden' | 'unavailable' }
  | null

export type TerminalLinkStatPort = (
  reference: TerminalLinkFileReference,
) => Promise<TerminalLinkStatResult>

/** Verifies a single identity; callers own cancellation and activation after resolution. */
export async function resolveTerminalLinkTarget(
  input: TerminalLinkTargetInput,
  source: TerminalLinkSourceContext,
  stat: TerminalLinkStatPort,
): Promise<TerminalLinkTargetResolution> {
  if (input.kind === 'url' && !/^file:/i.test(input.rawTarget)) {
    if (!/^https?:\/\//i.test(input.rawTarget)) {
      return { status: 'unresolved', reason: 'unsupported_scheme' }
    }
    try {
      const url = new URL(input.rawTarget)
      if (
        !url.hostname ||
        input.rawTarget.includes(' ') ||
        hasTerminalLinkControlCharacters(input.rawTarget)
      ) {
        return { status: 'unresolved', reason: 'invalid_target' }
      }
      return { status: 'resolved', target: { kind: 'url', uri: input.rawTarget } }
    } catch {
      return { status: 'unresolved', reason: 'invalid_target' }
    }
  }
  const prepared = prepareTerminalLinkPath(input.rawTarget, source)
  if (prepared.status === 'unresolved') {
    return prepared
  }
  const reference: TerminalLinkFileReference = {
    uri: prepared.uri,
    ...(source.mountId ? { mountId: source.mountId } : {}),
    ...(source.endpointId ? { endpointId: source.endpointId } : {}),
  }
  let entry: TerminalLinkStatResult
  try {
    entry = await stat(reference)
  } catch {
    return { status: 'unresolved', reason: 'unavailable' }
  }
  if (!entry) {
    return { status: 'unresolved', reason: 'not_found' }
  }
  if ('reason' in entry) {
    return { status: 'unresolved', reason: entry.reason }
  }
  if (entry.kind === 'unknown') {
    return { status: 'unresolved', reason: 'unsupported_entry' }
  }
  const target: TerminalResolvedFileTarget = {
    ...reference,
    kind: entry.kind,
    path: prepared.path,
  }
  for (const key of ['line', 'column', 'lineEnd', 'columnEnd'] as const) {
    const value = input[key]
    if (value !== undefined && Number.isSafeInteger(value) && value > 0) {
      target[key] = value
    }
  }
  return prepared.requiresConfirmation
    ? { status: 'confirmation_required', reason: 'launch_cwd', target }
    : { status: 'resolved', target }
}
