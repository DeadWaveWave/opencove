import { CONTROL_SURFACE_PROTOCOL_VERSION } from '../../../shared/contracts/controlSurface/protocol'
import type { Connection } from './context'
import { get } from './render'
import type { ErrorTarget, OptionSpec } from './command'
import { CliError, inputChoiceIssues, inputErrorMessage, validationError } from './errors'
export async function invoke(
  connection: Connection,
  request: { kind: string; id: string; payload: unknown },
  options: {
    timeoutMs: number
    fetch?: typeof fetch
    signal?: AbortSignal
    errorTargets?: ErrorTarget[]
    inputOptions?: Record<string, OptionSpec>
  },
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
    const authStatus = [401, 403].includes(response.status)
    const result = await response.json().catch(error => {
      if (authStatus) {
        return undefined
      }
      throw error
    })
    if (
      authStatus ||
      ['common.forbidden', 'control_surface.unauthorized'].includes(result?.error?.code)
    ) {
      throw new CliError(
        result?.error?.code ?? 'context.unauthorized',
        4,
        'Authorization failed. An OpenCove session may read and interact, but cannot perform administrative actions or manage workers.',
        'If you intend a broader action, run the command outside the OpenCove session with a desktop token.',
        result?.error?.details,
      )
    }
    if (result?.ok === false) {
      const error = result.error ?? {}
      const serverIssues = error.details?.issues
      const choices =
        error.code === 'common.invalid_input' &&
        (!Array.isArray(serverIssues) || !serverIssues.length)
          ? inputChoiceIssues(request.payload, options.inputOptions)
          : []
      const issues = choices.length ? choices : serverIssues
      if (Array.isArray(issues)) {
        const formatted = validationError(
          request.id,
          issues,
          2,
          error.code ?? 'common.invalid_input',
          request.payload,
        )
        formatted.details = { ...error.details, issues }
        throw formatted
      }
      const target = options.errorTargets?.find(
        candidate =>
          candidate.codes.includes(error.code) &&
          Object.values(candidate.fields).some(path => get(request.payload, path) !== undefined),
      )
      const targetDetails = target
        ? Object.fromEntries(
            Object.entries(target.fields)
              .map(([key, path]) => [key, get(request.payload, path)])
              .filter(([, value]) => value !== undefined),
          )
        : {}
      const targetAction = String(error.code).endsWith('.not_found')
        ? 'was not found'
        : String(error.code).endsWith('.unavailable')
          ? 'is unavailable'
          : String(error.code).endsWith('.unsupported_operation')
            ? 'does not support this operation'
            : undefined
      throw new CliError(
        error.code ?? 'operation.failed',
        error.code === 'common.invalid_input'
          ? 2
          : error.code === 'common.protocol_incompatible'
            ? 5
            : error.code === 'space.ambiguous'
              ? 6
              : 1,
        target?.entity && targetAction
          ? `${target.entity} ${JSON.stringify(Object.values(targetDetails)[0])} ${targetAction}`
          : error.code === 'common.invalid_input'
            ? inputErrorMessage(request.id, error.debugMessage)
            : (error.debugMessage ?? error.code ?? 'Operation failed'),
        error.code === 'common.approved_path_required'
          ? 'Run "opencove mount list --project <id>" to see approved roots.'
          : target
            ? `Run "${target.listCommand}" to find available targets.`
            : undefined,
        target ? { ...error.details, ...targetDetails } : error.details,
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
