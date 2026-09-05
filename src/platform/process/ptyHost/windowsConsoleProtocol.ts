export type WindowsConsoleGeometry = { cols: number; rows: number }
export type WindowsConsoleRequest = { type: 'read'; requestId: number; pid: number }
export type WindowsConsoleResponse =
  | { type: 'ready' }
  | { type: 'unavailable'; error: string }
  | { type: 'geometry'; requestId: number; geometry: WindowsConsoleGeometry }
  | { type: 'error'; requestId: number; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPositiveInteger(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= max
}

function isError(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 1_024
}

export function isWindowsConsoleRequest(value: unknown): value is WindowsConsoleRequest {
  return (
    isRecord(value) &&
    Object.keys(value).length === 3 &&
    value.type === 'read' &&
    isPositiveInteger(value.requestId, Number.MAX_SAFE_INTEGER) &&
    isPositiveInteger(value.pid, 0xfffffffe)
  )
}

export function isWindowsConsoleResponse(value: unknown): value is WindowsConsoleResponse {
  if (!isRecord(value)) {
    return false
  }
  const keys = Object.keys(value).length
  if (value.type === 'ready') {
    return keys === 1
  }
  if (value.type === 'unavailable') {
    return keys === 2 && isError(value.error)
  }
  if (keys !== 3 || !isPositiveInteger(value.requestId, Number.MAX_SAFE_INTEGER)) {
    return false
  }
  if (value.type === 'error') {
    return isError(value.error)
  }
  return (
    value.type === 'geometry' &&
    isRecord(value.geometry) &&
    Object.keys(value.geometry).length === 2 &&
    isPositiveInteger(value.geometry.cols, 32_767) &&
    isPositiveInteger(value.geometry.rows, 32_767)
  )
}
