import { DEFAULT_TIMEOUT_MS } from './constants.mjs'

async function invokeControlSurface(connection, request, options) {
  const controller = new AbortController()
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const url = `http://${connection.hostname}:${connection.port}/invoke`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    })

    const raw = await response.text()
    const parsed = raw.trim().length > 0 ? JSON.parse(raw) : null
    return { httpStatus: response.status, result: parsed }
  } finally {
    clearTimeout(timer)
  }
}

export async function invokeAndPrint(connection, request, { pretty, timeoutMs } = {}) {
  const { result } = await invokeControlSurface(connection, request, { timeoutMs })
  const output = pretty ? JSON.stringify(result, null, 2) : JSON.stringify(result)
  process.stdout.write(`${output}\n`)

  if (result && result.ok === false) {
    process.exit(1)
  }

  return result
}
