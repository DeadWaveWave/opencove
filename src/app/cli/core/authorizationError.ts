import { CliError } from './errors'
import { nodeParentErrorPresentation } from '../../../shared/errors/nodeParentError'

/** HTTP authentication/authorization status takes precedence over legacy descriptors. */
export function authorizationError(
  status: number | undefined,
  error?: { code?: string; details?: unknown },
): CliError | undefined {
  if (status === 401 || (status !== 403 && error?.code === 'control_surface.unauthorized')) {
    return new CliError(
      error?.code ?? 'context.unauthorized',
      4,
      'The control token is invalid or has been revoked.',
      'Check the endpoint and restart the terminal if its session has ended.',
    )
  }
  if (status === 403 || error?.code === 'common.forbidden') {
    const parent =
      error?.code === 'common.forbidden' ? nodeParentErrorPresentation(error) : undefined
    const details = error?.details
    const policy =
      details && typeof details === 'object' ? (details as Record<string, unknown>) : undefined
    const policyReason = policy?.reason === 'operation_denied' || policy?.reason === 'field_denied'
    return new CliError(
      error?.code ?? 'common.forbidden',
      4,
      parent?.message ??
        (policyReason && typeof policy?.message === 'string'
          ? policy.message
          : 'This credential does not permit the operation.'),
      parent?.hint,
      details,
    )
  }
  return undefined
}
