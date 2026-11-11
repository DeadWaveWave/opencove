import { agentSpawnErrorPresentation } from '../../../shared/errors/agentSpawnError'
import { isConnectionRefused } from '../../../shared/errors/connectionRefused'
import { isPromptDeliveryResult, normalizePromptDeliveryResult } from './promptTransport'
import {
  agentPromptErrorPresentation,
  promptValidationPresentation,
  promptUnknownRecovery,
} from '../../../shared/errors/agentPromptError'
import { isAppErrorDescriptor, formatAppErrorMessage } from '../../../shared/errors/appError'
import { nodeParentErrorPresentation } from '../../../shared/errors/nodeParentError'
import { CONTROL_SURFACE_PROTOCOL_VERSION } from '../../../shared/contracts/controlSurface/protocol'
import type { Connection } from './context'
import { get } from './render'
import type { ErrorTarget, OptionSpec } from './command'
import { CliError, inputChoiceIssues, inputErrorMessage, validationError } from './errors'
import { authorizationError } from './authorizationError'
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
  const prompt = request.id === 'agent.prompt'
  let dispatched = false
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
    dispatched = true
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
    const authError = authorizationError(response.status, result?.error)
    if (authError) {
      throw authError
    }
    if (result?.ok === false) {
      const error = result.error ?? {}
      const parent = nodeParentErrorPresentation(error)
      if (parent) {
        throw new CliError(error.code, 1, parent.message, parent.hint, error.details)
      }
      if (prompt && !isAppErrorDescriptor(error)) {
        throw new CliError('transport.invalid_response', 1, 'Invalid control surface response')
      }
      const unknownHandler = `Unknown control surface ${request.kind}: ${request.id}`
      if (
        error.code === 'common.invalid_input' &&
        (request.kind === 'query' || request.kind === 'command') &&
        (error.debugMessage === unknownHandler || error.debugMessage === `Error: ${unknownHandler}`)
      ) {
        throw new CliError(
          error.code,
          5,
          `The connected OpenCove Worker is older than this CLI and does not support ${request.id}. Restart or update OpenCove.`,
          undefined,
          error.details,
          // Capability negotiation still needs the canonical diagnostic.
          unknownHandler,
        )
      }
      if (prompt && error.code === 'common.invalid_input') {
        const text = promptValidationPresentation(error.details)
        throw new CliError(
          error.code,
          2,
          text.message,
          text.hint,
          error.details,
          error.debugMessage,
        )
      }
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
      const spawn = agentSpawnErrorPresentation(error)
      const promptError =
        prompt && isAppErrorDescriptor(error) ? agentPromptErrorPresentation(error) : undefined
      const attemptsKnown =
        typeof error.details?.pasteDispatchAttempted === 'boolean' &&
        typeof error.details?.submitDispatchAttempted === 'boolean'
      throw new CliError(
        error.code ?? 'operation.failed',
        error.code === 'agent.prompt_timeout' ||
          (request.id === 'agent.prompt' && error.details?.reason === 'deadline')
          ? 124
          : error.code === 'common.invalid_input'
            ? 2
            : error.code === 'common.protocol_incompatible'
              ? 5
              : error.code === 'space.ambiguous'
                ? 6
                : 1,
        // agent.prompt renders its own recovery text; other commands keep target-aware messages.
        spawn?.message ??
          (prompt
            ? (promptError?.message ??
              (!attemptsKnown
                ? 'Prompt delivery failed. The outcome is unknown.'
                : formatAppErrorMessage(error)))
            : target?.entity && targetAction
              ? `${target.entity} ${JSON.stringify(Object.values(targetDetails)[0])} ${targetAction}`
              : error.code === 'common.invalid_input'
                ? inputErrorMessage(request.id, error.debugMessage)
                : (error.debugMessage ?? error.code ?? 'Operation failed')),
        spawn?.hint ??
          (prompt
            ? (promptError?.hint ?? promptUnknownRecovery)
            : error.code === 'common.approved_path_required'
              ? 'Run "opencove mount list --project <id>" to see approved roots.'
              : target
                ? `Run "${target.listCommand}" to find available targets.`
                : undefined),
        prompt && !attemptsKnown
          ? { ...error.details, deliveryOutcome: 'unknown' }
          : target
            ? { ...error.details, ...targetDetails }
            : error.details,
        prompt ? error.debugMessage : undefined,
      )
    }
    if (!response.ok || result?.ok !== true || (prompt && !isPromptDeliveryResult(result.value))) {
      throw new CliError('transport.invalid_response', 1, 'Invalid control surface response')
    }
    return prompt ? normalizePromptDeliveryResult(result.value) : result.value
  } catch (error) {
    if (options.signal?.aborted) {
      if (prompt) {
        throw new CliError(
          'cli.interrupted',
          130,
          dispatched
            ? 'Prompt delivery was interrupted. The outcome is unknown.'
            : 'Interrupted before delivery began. Nothing was sent.',
          dispatched ? promptUnknownRecovery : 'Retry when ready.',
          dispatched ? { deliveryOutcome: 'unknown' } : undefined,
        )
      }
      throw new CliError('cli.interrupted', 130, 'Interrupted')
    }
    if (error instanceof CliError) {
      if (!prompt) {
        throw error
      }
      if (error.code !== 'transport.invalid_response') {
        throw error
      }
      throw new CliError(
        error.code,
        error.exitCode,
        'OpenCove returned an invalid delivery response. The outcome is unknown.',
        promptUnknownRecovery,
        { deliveryOutcome: 'unknown' },
      )
    }
    if (controller.signal.aborted) {
      throw new CliError(
        'transport.timeout',
        124,
        request.id === 'agent.prompt'
          ? 'Timed out waiting for the delivery result. The outcome is unknown.'
          : 'Request timed out',
        prompt ? promptUnknownRecovery : undefined,
        prompt
          ? { deliveryOutcome: 'unknown' }
          : request.kind === 'query'
            ? { reason: 'read_timeout' }
            : undefined,
      )
    }
    throw new CliError(
      'context.unreachable',
      3,
      prompt
        ? `Could not obtain a delivery result from OpenCove at ${connection.endpoint}. The outcome is unknown.`
        : `OpenCove endpoint ${connection.endpoint} is unreachable.`,
      request.id === 'agent.prompt'
        ? promptUnknownRecovery
        : 'Check the endpoint URL and ensure the OpenCove app or worker is running.',
      {
        endpoint: connection.endpoint,
        ...(prompt
          ? { deliveryOutcome: 'unknown' }
          : request.kind === 'query' && isConnectionRefused(error)
            ? { reason: 'connection_refused' }
            : {}),
      },
    )
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', interrupt)
  }
}
