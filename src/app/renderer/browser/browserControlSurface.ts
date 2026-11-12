import { createAppError } from '@shared/errors/appError'
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
): Promise<TValue> {
  const { raw, status } = await fetchInvokeResponse(request)
  const parsed = raw.trim().length > 0 ? (JSON.parse(raw) as unknown satisfies unknown) : null
  const result =
    parsed &&
    typeof parsed === 'object' &&
    (parsed as Record<string, unknown>).__opencoveControlEnvelope === true
      ? (parsed as ControlSurfaceInvokeResult<TValue>)
      : null

  if (!result) {
    throw new Error(`Invalid control-surface response (HTTP ${status})`)
  }

  if (result.ok === false) {
    if (request.id.startsWith('plugin.')) {
      throw createAppError(result.error)
    }
    throw result.error
  }

  return result.value
}
