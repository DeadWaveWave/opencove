import type {
  ControlSurfaceInvokeRequest,
  ControlSurfaceInvokeResult,
} from '../../../../shared/contracts/controlSurface'

export interface ControlSurfaceRemoteEndpoint {
  hostname: string
  port: number
  token: string
}

export async function invokeControlSurface(
  endpoint: ControlSurfaceRemoteEndpoint,
  request: ControlSurfaceInvokeRequest,
  options: { timeoutMs?: number } = {},
): Promise<{ httpStatus: number; result: ControlSurfaceInvokeResult<unknown> | null }> {
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? 15_000
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const url = `http://${endpoint.hostname}:${endpoint.port}/invoke`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${endpoint.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    })

    const raw = await response.text()
    const parsed = raw.trim().length > 0 ? (JSON.parse(raw) as unknown) : null

    const result =
      parsed &&
      typeof parsed === 'object' &&
      (parsed as Record<string, unknown>).__opencoveControlEnvelope === true
        ? (parsed as ControlSurfaceInvokeResult<unknown>)
        : null

    return { httpStatus: response.status, result }
  } finally {
    clearTimeout(timer)
  }
}
