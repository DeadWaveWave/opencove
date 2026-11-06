import { CONTROL_SURFACE_PROTOCOL_VERSION } from '../../../shared/contracts/controlSurface/protocol'
import type { Connection } from './context'
import { CliError } from './errors'
export async function invoke(
  connection: Connection,
  request: { kind: string; id: string; payload: unknown },
  options: { timeoutMs: number; fetch?: typeof fetch; signal?: AbortSignal },
) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs)
  const interrupt = () => controller.abort()
  options.signal?.addEventListener('abort', interrupt, { once: true })
  if (options.signal?.aborted) {
    controller.abort()
  }
  try {
    if (options.signal?.aborted) {
      throw new CliError('cli.interrupted', 130, 'Interrupted')
    }
    const response = await (options.fetch ?? fetch)(`${connection.endpoint}/invoke`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.token}`,
        'content-type': 'application/json',
        'x-opencove-protocol': String(CONTROL_SURFACE_PROTOCOL_VERSION),
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    })
    if ([401, 403].includes(response.status)) {
      throw new CliError('context.unauthorized', 4, 'Unauthorized or forbidden')
    }
    const result = await response.json()
    if (result?.ok === false) {
      const error = result.error ?? {}
      throw new CliError(
        error.code ?? 'operation.failed',
        error.code === 'common.protocol_incompatible'
          ? 5
          : error.code === 'space.ambiguous'
            ? 6
            : 1,
        error.debugMessage ?? error.code ?? 'Operation failed',
        undefined,
        error.details,
      )
    }
    if (!response.ok || result?.ok !== true) {
      throw new CliError('transport.invalid_response', 1, 'Invalid control surface response')
    }
    return result.value
  } catch (error) {
    if (options.signal?.aborted) {
      throw new CliError('cli.interrupted', 130, 'Interrupted')
    }
    if (error instanceof CliError) {
      throw error
    }
    if (controller.signal.aborted) {
      throw new CliError('transport.timeout', 124, 'Request timed out')
    }
    throw new CliError(
      'context.unreachable',
      3,
      `OpenCove endpoint ${connection.endpoint} is unreachable.`,
      'Check the endpoint URL and ensure the OpenCove app or worker is running.',
      { endpoint: connection.endpoint },
    )
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', interrupt)
  }
}
