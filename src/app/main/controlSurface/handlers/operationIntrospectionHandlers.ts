import * as z from 'zod'
import { CONTROL_SURFACE_PROTOCOL_VERSION } from '../../../../shared/contracts/controlSurface'
import {
  CONTROL_SURFACE_OPERATIONS,
  getControlSurfaceOperation,
} from '../../../../shared/contracts/controlSurface/operations'
import {
  systemOperationsOperation,
  systemOperationDescribeOperation,
} from '../../../../shared/contracts/controlSurface/operations/domains/system'
import { createAppError } from '../../../../shared/errors/appError'
import type { ControlSurface } from '../controlSurface'
import { registerOperation } from '../registerOperation'

function metadata({
  id,
  kind,
  scope,
  availability,
  contract,
  summary,
}: (typeof CONTROL_SURFACE_OPERATIONS)[number]) {
  return { id, kind, scope, availability, contract, summary }
}

export function registerOperationIntrospectionHandlers(controlSurface: ControlSurface): void {
  // Derived schemas belong to this runtime, and are never computed by listing operations.
  const schemas = new Map<string, object>()
  registerOperation(controlSurface, systemOperationsOperation, {
    defaultErrorCode: 'common.unexpected',
    handle: () => ({
      protocolVersion: CONTROL_SURFACE_PROTOCOL_VERSION,
      operations: CONTROL_SURFACE_OPERATIONS.filter(op => controlSurface.hasOperation(op.id))
        .map(metadata)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    }),
  })
  registerOperation(controlSurface, systemOperationDescribeOperation, {
    defaultErrorCode: 'common.unexpected',
    handle: (_ctx, { id }) => {
      const op = getControlSurfaceOperation(id)
      if (!op || !controlSurface.hasOperation(id)) {
        throw createAppError('common.invalid_input', {
          debugMessage: `Unknown or unregistered operation: ${id}`,
        })
      }
      let inputSchema: object | null = null
      if (op.contract === 'schema') {
        inputSchema =
          schemas.get(id) ?? z.toJSONSchema(op.input, { io: 'input', unrepresentable: 'throw' })
        schemas.set(id, inputSchema)
      }
      return {
        ...metadata(op),
        inputSchema,
        errors: op.contract === 'schema' ? [...op.errors] : [],
      }
    },
  })
}
