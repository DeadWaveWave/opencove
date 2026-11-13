import type * as z from 'zod'
import type { SchemaOperation } from '../../../shared/contracts/controlSurface/operations/defineOperation'
import type { ControlSurfaceOperationKind } from '../../../shared/contracts/controlSurface'
import { createAppError } from '../../../shared/errors/appError'
import type { ControlSurface } from './controlSurface'
import type { ControlSurfaceHandler } from './types'

export function registerOperation<
  Id extends string,
  Kind extends ControlSurfaceOperationKind,
  Wire extends z.ZodType,
  Input,
  Result,
>(
  controlSurface: ControlSurface,
  operation: SchemaOperation<Id, Kind, Wire, Input>,
  handler: Pick<ControlSurfaceHandler<Input, Result>, 'handle' | 'defaultErrorCode'>,
): void {
  controlSurface.register(operation.id, {
    ...handler,
    kind: operation.kind,
    validate: payload => {
      const result = operation.input.safeParse(payload)
      if (!result.success) {
        // @compat control-surface-legacy-validation
        // Replay only for the legacy error descriptor. A returning hook must never
        // admit a payload rejected by the wire schema.
        operation.legacyNormalize?.(payload)
        const issues = result.error.issues.map(({ path, code, message }) => ({
          path,
          code,
          message,
        }))
        const first = issues[0]
        throw createAppError('common.invalid_input', {
          debugMessage: `Invalid payload for ${operation.id}: ${first.path.join('.')}: ${first.message}`,
          details: { issues },
        })
      }
      // @compat control-surface-legacy-validation
      // Object parsers may discard own __proto__ keys; compatibility checks must
      // inspect the original payload, after schema admission has succeeded.
      return operation.legacyNormalize
        ? operation.legacyNormalize(payload)
        : operation.normalize(result.data)
    },
  })
}
