import type { ForegroundAgentReconciliationEvent } from '../../../shared/runtime/agentForegroundRecognition'

export const PTY_HOST_PROTOCOL_VERSION = 6 as const
export const PTY_HOST_MAX_GEOMETRY_DIMENSION = 32_767

const PTY_HOST_MAX_ID_LENGTH = 256

export type PtyHostWriteEncoding = 'utf8' | 'binary'
export type PtyHostResponseRequestType = 'spawn' | 'resize'

type PtyHostInstanceIdentity = {
  hostInstanceId: string
}

export type PtyHostSpawnRequest = PtyHostInstanceIdentity & {
  type: 'spawn'
  requestId: string
  launchId: string
  command: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  cols: number
  rows: number
}

export type PtyHostWriteRequest = PtyHostInstanceIdentity & {
  type: 'write'
  sessionId: string
  data: string
  encoding: PtyHostWriteEncoding
}

export type PtyHostResizeRequest = PtyHostInstanceIdentity & {
  type: 'resize'
  requestId: string
  sessionId: string
  cols: number
  rows: number
}

export type PtyHostForegroundProbeRequest = PtyHostInstanceIdentity & {
  type: 'foreground_probe'
  sessionId: string
}

export type PtyHostResizeAck =
  | { status: 'applied_verified'; cols: number; rows: number }
  | { status: 'applied_unverified' }

export type PtyHostKillRequest = PtyHostInstanceIdentity & {
  type: 'kill'
  sessionId: string
}

export type PtyHostShutdownRequest = PtyHostInstanceIdentity & {
  type: 'shutdown'
}

export type PtyHostCrashRequest = PtyHostInstanceIdentity & {
  type: 'crash'
}

export type PtyHostRequest =
  | PtyHostSpawnRequest
  | PtyHostWriteRequest
  | PtyHostResizeRequest
  | PtyHostForegroundProbeRequest
  | PtyHostKillRequest
  | PtyHostShutdownRequest
  | PtyHostCrashRequest

export type PtyHostReadyEnvelope = {
  type: 'ready'
  protocolVersion: number
  hostInstanceId: string
}

export type PtyHostReadyMessage = PtyHostReadyEnvelope & {
  protocolVersion: typeof PTY_HOST_PROTOCOL_VERSION
}

type PtyHostErrorResponseMessage<RequestType extends PtyHostResponseRequestType> =
  PtyHostInstanceIdentity & {
    type: 'response'
    requestType: RequestType
    requestId: string
    ok: false
    error: { name?: string; message: string }
  }

export type PtyHostSpawnResponseMessage =
  | (PtyHostInstanceIdentity & {
      type: 'response'
      requestType: 'spawn'
      requestId: string
      ok: true
      result: { sessionId: string }
    })
  | PtyHostErrorResponseMessage<'spawn'>

export type PtyHostResizeResponseMessage =
  | (PtyHostInstanceIdentity & {
      type: 'response'
      requestType: 'resize'
      requestId: string
      ok: true
      result: { sessionId: string; resize: PtyHostResizeAck }
    })
  | PtyHostErrorResponseMessage<'resize'>

export type PtyHostResponseMessage = PtyHostSpawnResponseMessage | PtyHostResizeResponseMessage

export type PtyHostDataMessage = PtyHostInstanceIdentity & {
  type: 'data'
  sessionId: string
  data: string
}

export type PtyHostExitMessage = PtyHostInstanceIdentity & {
  type: 'exit'
  sessionId: string
  exitCode: number
}

export type PtyHostForegroundMessage = PtyHostInstanceIdentity &
  ForegroundAgentReconciliationEvent & {
    type: 'foreground'
  }

export type PtyHostForegroundEvent = ForegroundAgentReconciliationEvent

export type PtyHostMessage =
  | PtyHostReadyMessage
  | PtyHostResponseMessage
  | PtyHostDataMessage
  | PtyHostExitMessage
  | PtyHostForegroundMessage

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value) as unknown
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(record)
  return actualKeys.length === keys.length && keys.every(key => Object.hasOwn(record, key))
}

function hasOnlyKeys(
  record: Record<string, unknown>,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
): boolean {
  const allowedKeys = new Set([...requiredKeys, ...optionalKeys])
  return (
    requiredKeys.every(key => Object.hasOwn(record, key)) &&
    Object.keys(record).every(key => allowedKeys.has(key))
  )
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= PTY_HOST_MAX_ID_LENGTH &&
    value.trim() === value
  )
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function isProcessEnv(value: unknown): value is NodeJS.ProcessEnv {
  return (
    isRecord(value) &&
    Object.values(value).every(item => typeof item === 'string' || item === undefined)
  )
}

export function isSafePtyHostGeometry(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= PTY_HOST_MAX_GEOMETRY_DIMENSION
  )
}

function hasCurrentHostInstance(
  record: Record<string, unknown>,
  expectedHostInstanceId: string,
): boolean {
  return isIdentifier(expectedHostInstanceId) && record.hostInstanceId === expectedHostInstanceId
}

export function isPtyHostReadyEnvelope(value: unknown): value is PtyHostReadyEnvelope {
  if (!isRecord(value) || !hasExactKeys(value, ['type', 'protocolVersion', 'hostInstanceId'])) {
    return false
  }
  return (
    value.type === 'ready' &&
    typeof value.protocolVersion === 'number' &&
    Number.isSafeInteger(value.protocolVersion) &&
    isIdentifier(value.hostInstanceId)
  )
}

export function readPtyHostResponseIdentity(
  value: unknown,
): { hostInstanceId: string; requestId: string } | null {
  if (
    !isRecord(value) ||
    value.type !== 'response' ||
    !isIdentifier(value.hostInstanceId) ||
    !isIdentifier(value.requestId)
  ) {
    return null
  }
  return { hostInstanceId: value.hostInstanceId, requestId: value.requestId }
}

export function readPtyHostSpawnSuccessRetirementIdentity(
  value: unknown,
): { hostInstanceId: string; requestId: string; sessionId: string } | null {
  if (
    !isRecord(value) ||
    value.type !== 'response' ||
    value.requestType !== 'spawn' ||
    value.ok !== true ||
    !isIdentifier(value.hostInstanceId) ||
    !isIdentifier(value.requestId) ||
    !isRecord(value.result) ||
    !isIdentifier(value.result.sessionId)
  ) {
    return null
  }
  return {
    hostInstanceId: value.hostInstanceId,
    requestId: value.requestId,
    sessionId: value.result.sessionId,
  }
}

function isResizeAck(value: unknown): value is PtyHostResizeAck {
  if (!isRecord(value)) {
    return false
  }
  if (value.status === 'applied_unverified') {
    return hasExactKeys(value, ['status'])
  }
  return (
    value.status === 'applied_verified' &&
    hasExactKeys(value, ['status', 'cols', 'rows']) &&
    isSafePtyHostGeometry(value.cols) &&
    isSafePtyHostGeometry(value.rows)
  )
}

function isErrorResponse(record: Record<string, unknown>): boolean {
  if (
    !hasExactKeys(record, ['type', 'requestType', 'hostInstanceId', 'requestId', 'ok', 'error']) ||
    record.ok !== false ||
    !isRecord(record.error) ||
    !hasOnlyKeys(record.error, ['message'], ['name']) ||
    !isNonBlankString(record.error.message)
  ) {
    return false
  }
  return record.error.name === undefined || typeof record.error.name === 'string'
}

function isResponseMessage(record: Record<string, unknown>): record is PtyHostResponseMessage {
  if (
    record.type !== 'response' ||
    (record.requestType !== 'spawn' && record.requestType !== 'resize') ||
    !isIdentifier(record.hostInstanceId) ||
    !isIdentifier(record.requestId)
  ) {
    return false
  }
  if (record.ok === false) {
    return isErrorResponse(record)
  }
  if (
    record.ok !== true ||
    !hasExactKeys(record, ['type', 'requestType', 'hostInstanceId', 'requestId', 'ok', 'result']) ||
    !isRecord(record.result)
  ) {
    return false
  }
  if (record.requestType === 'spawn') {
    return hasExactKeys(record.result, ['sessionId']) && isIdentifier(record.result.sessionId)
  }
  return (
    hasExactKeys(record.result, ['sessionId', 'resize']) &&
    isIdentifier(record.result.sessionId) &&
    isResizeAck(record.result.resize)
  )
}

function isForegroundObservation(record: Record<string, unknown>): boolean {
  if (
    !hasExactKeys(record, [
      'type',
      'hostInstanceId',
      'sessionId',
      'observedAtMs',
      'source',
      'exitCode',
      'availability',
      'agent',
      'shellOnly',
    ]) ||
    !isIdentifier(record.hostInstanceId) ||
    !isIdentifier(record.sessionId) ||
    typeof record.observedAtMs !== 'number' ||
    !Number.isSafeInteger(record.observedAtMs) ||
    record.observedAtMs < 0
  ) {
    return false
  }
  if (record.source === 'windows_exit_code') {
    return (
      typeof record.exitCode === 'number' &&
      Number.isSafeInteger(record.exitCode) &&
      record.availability === 'unavailable' &&
      record.agent === null &&
      record.shellOnly === false
    )
  }
  if (record.source === 'windows_prompt_timeout') {
    return (
      record.exitCode === null &&
      record.availability === 'unavailable' &&
      record.agent === null &&
      record.shellOnly === false
    )
  }
  if (record.source !== 'process_scan' || record.exitCode !== null) {
    return false
  }
  if (record.availability === 'unavailable') {
    return record.agent === null && record.shellOnly === false
  }
  return (
    record.availability === 'available' &&
    (record.agent === null || record.agent === 'codex') &&
    typeof record.shellOnly === 'boolean'
  )
}

export function isPtyHostMessage(value: unknown): value is PtyHostMessage {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false
  }
  if (value.type === 'ready') {
    return isPtyHostReadyEnvelope(value) && value.protocolVersion === PTY_HOST_PROTOCOL_VERSION
  }
  if (value.type === 'response') {
    return isResponseMessage(value)
  }
  if (value.type === 'data') {
    return (
      hasExactKeys(value, ['type', 'hostInstanceId', 'sessionId', 'data']) &&
      isIdentifier(value.hostInstanceId) &&
      isIdentifier(value.sessionId) &&
      typeof value.data === 'string'
    )
  }
  if (value.type === 'exit') {
    return (
      hasExactKeys(value, ['type', 'hostInstanceId', 'sessionId', 'exitCode']) &&
      isIdentifier(value.hostInstanceId) &&
      isIdentifier(value.sessionId) &&
      typeof value.exitCode === 'number' &&
      Number.isSafeInteger(value.exitCode)
    )
  }
  return value.type === 'foreground' && isForegroundObservation(value)
}

export function isPtyHostRequest(
  value: unknown,
  expectedHostInstanceId: string,
): value is PtyHostRequest {
  if (
    !isRecord(value) ||
    typeof value.type !== 'string' ||
    !hasCurrentHostInstance(value, expectedHostInstanceId)
  ) {
    return false
  }
  if (value.type === 'spawn') {
    return (
      hasExactKeys(value, [
        'type',
        'hostInstanceId',
        'requestId',
        'launchId',
        'command',
        'args',
        'cwd',
        'env',
        'cols',
        'rows',
      ]) &&
      isIdentifier(value.requestId) &&
      isIdentifier(value.launchId) &&
      isNonBlankString(value.command) &&
      isStringArray(value.args) &&
      isNonBlankString(value.cwd) &&
      isProcessEnv(value.env) &&
      isSafePtyHostGeometry(value.cols) &&
      isSafePtyHostGeometry(value.rows)
    )
  }
  if (value.type === 'write') {
    return (
      hasExactKeys(value, ['type', 'hostInstanceId', 'sessionId', 'data', 'encoding']) &&
      isIdentifier(value.sessionId) &&
      typeof value.data === 'string' &&
      (value.encoding === 'utf8' || value.encoding === 'binary')
    )
  }
  if (value.type === 'resize') {
    return (
      hasExactKeys(value, ['type', 'hostInstanceId', 'requestId', 'sessionId', 'cols', 'rows']) &&
      isIdentifier(value.requestId) &&
      isIdentifier(value.sessionId) &&
      isSafePtyHostGeometry(value.cols) &&
      isSafePtyHostGeometry(value.rows)
    )
  }
  if (value.type === 'foreground_probe' || value.type === 'kill') {
    return (
      hasExactKeys(value, ['type', 'hostInstanceId', 'sessionId']) && isIdentifier(value.sessionId)
    )
  }
  return (
    (value.type === 'shutdown' || value.type === 'crash') &&
    hasExactKeys(value, ['type', 'hostInstanceId'])
  )
}
