import { reviveRendererAppError } from '@shared/errors/rendererAppError'
import { RendererTransportError } from '@shared/errors/rendererTransportError'
import type {
  ControlSurfaceInvokeRequest,
  ControlSurfaceInvokeResult,
} from '@shared/contracts/controlSurface'

function resolveQueryToken(): string | null {
  if (typeof window === 'undefined') {
    return null
  }

  const params = new URLSearchParams(window.location.search)
  const token = params.get('token')
  return token && token.trim().length > 0 ? token.trim() : null
}

export function getBrowserQueryToken(): string | null {
  return resolveQueryToken()
}

// Identical queries that are already in flight share one HTTP request: during a project switch
// several components ask for the same snapshot or status at once. Each caller parses its own
// copy of the response. Commands are never shared, and a command makes later queries start a
// fresh request so they cannot observe a response from before the command.
const inFlightQueries = new Map<string, Promise<{ raw: string; status: number }>>()

function fetchInvokeResponse(
  request: ControlSurfaceInvokeRequest,
): Promise<{ raw: string; status: number }> {
  const body = JSON.stringify(request)
  if (request.kind !== 'query') {
    inFlightQueries.clear()
    return postInvoke(body)
  }
  const existing = inFlightQueries.get(body)
  if (existing) {
    return existing
  }
  const pending = postInvoke(body).finally(() => {
    if (inFlightQueries.get(body) === pending) {
      inFlightQueries.delete(body)
    }
  })
  inFlightQueries.set(body, pending)
  return pending
}

async function postInvoke(body: string): Promise<{ raw: string; status: number }> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }

  const token = resolveQueryToken()
  if (token) {
    headers.authorization = `Bearer ${token}`
  }

  const response = await fetch('/invoke', {
    method: 'POST',
    credentials: 'same-origin',
    headers,
    body,
  })

  return { raw: await response.text(), status: response.status }
}

export async function invokeBrowserControlSurface<TValue>(
  request: ControlSurfaceInvokeRequest,
  validateValue?: (value: unknown) => boolean,
): Promise<TValue> {
  const { raw } = await fetchInvokeResponse(request)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // A body that is not a JSON envelope proves nothing about whether a command ran.
    throw new RendererTransportError()
  }
  const result =
    parsed &&
    typeof parsed === 'object' &&
    Object.hasOwn(parsed, '__opencoveControlEnvelope') &&
    (parsed as Record<string, unknown>).__opencoveControlEnvelope === true
      ? (parsed as ControlSurfaceInvokeResult<TValue>)
      : null

  if (!result) {
    throw new RendererTransportError()
  }

  if (result.ok === false) {
    throw reviveRendererAppError(result.error)
  }
  // JSON omits undefined properties: a successful void command has no value key.
  // Callers that require a payload validate its domain shape separately.
  if (result.ok !== true || (validateValue && !validateValue(result.value))) {
    throw new RendererTransportError()
  }

  return result.value
}
