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

export async function invokeBrowserControlSurface<TValue>(
  request: ControlSurfaceInvokeRequest,
): Promise<TValue> {
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
    body: JSON.stringify(request),
  })

  const raw = await response.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
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
  if (result.ok !== true || !Object.hasOwn(result, 'value')) {
    throw new RendererTransportError()
  }

  return result.value
}
