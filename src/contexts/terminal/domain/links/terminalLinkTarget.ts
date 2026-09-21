export interface TerminalLinkSourceContext {
  cwd?: string
  cwdSource: 'observed' | 'launch' | 'unknown'
  mountId?: string
  endpointId?: string
  platform?: 'posix' | 'windows'
  home?: string
}

export interface TerminalLinkSelection {
  line?: number
  column?: number
  lineEnd?: number
  columnEnd?: number
}

export interface TerminalLinkTargetInput extends TerminalLinkSelection {
  kind: 'file' | 'url'
  /** A filesystem name or URI with the already-parsed editor suffix removed. */
  rawTarget: string
}

export interface TerminalLinkFileReference {
  uri: string
  mountId?: string
  endpointId?: string
}

export interface TerminalResolvedFileTarget
  extends TerminalLinkFileReference, TerminalLinkSelection {
  kind: 'file' | 'directory'
  path: string
}

export interface TerminalResolvedUrlTarget {
  kind: 'url'
  uri: string
}

export type TerminalLinkUnresolvedReason =
  | 'not_found'
  | 'forbidden'
  | 'unavailable'
  | 'unknown_cwd'
  | 'unknown_home'
  | 'platform_mismatch'
  | 'unsupported_scheme'
  | 'unsupported_authority'
  | 'unsupported_entry'
  | 'invalid_target'

export interface TerminalUnresolvedLinkTarget {
  status: 'unresolved'
  reason: TerminalLinkUnresolvedReason
}

export type TerminalLinkTargetResolution =
  | { status: 'resolved'; target: TerminalResolvedFileTarget | TerminalResolvedUrlTarget }
  | {
      status: 'confirmation_required'
      reason: 'launch_cwd'
      target: TerminalResolvedFileTarget
    }
  | TerminalUnresolvedLinkTarget
