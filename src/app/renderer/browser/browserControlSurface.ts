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
  const parsed = raw.trim().length > 0 ? (JSON.parse(raw) as unknown satisfies unknown) : null
  const result =
    parsed &&
    typeof parsed === 'object' &&
    (parsed as Record<string, unknown>).__opencoveControlEnvelope === true
      ? (parsed as ControlSurfaceInvokeResult<TValue>)
      : null

  if (!result) {
    throw new Error(`Invalid control-surface response (HTTP ${response.status})`)
  }

  if (result.ok === false) {
    throw result.error
  }

  return result.value
}
