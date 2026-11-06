import type * as z from 'zod'
import type { AppErrorCode } from '../../dto'
import type { ControlSurfaceOperationKind } from '../../controlSurface'

export type OperationScope = 'read' | 'interact' | 'admin'
export type OperationAvailability =
  | 'always'
  | 'desktop-managed-worker'
  | 'managed-runtime'
  | 'debug'
export interface OperationMeta<Id extends string, Kind extends ControlSurfaceOperationKind> {
  id: Id
  kind: Kind
  scope: OperationScope
  summary: string
  availability: OperationAvailability
}
export interface SchemaOperation<
  Id extends string,
  Kind extends ControlSurfaceOperationKind,
  Wire extends z.ZodType,
  Input,
> extends OperationMeta<Id, Kind> {
  contract: 'schema'
  input: Wire
  normalize: (wire: z.output<Wire>) => Input
  errors: readonly AppErrorCode[]
}
export interface LegacyOperation<
  Id extends string,
  Kind extends ControlSurfaceOperationKind,
> extends OperationMeta<Id, Kind> {
  contract: 'legacy'
}
export function defineOperation<
  const Id extends string,
  const Kind extends ControlSurfaceOperationKind,
  Wire extends z.ZodType,
  Input = z.output<Wire>,
>(
  definition: OperationMeta<Id, Kind> & {
    input: Wire
    errors: readonly AppErrorCode[]
    normalize: (wire: z.output<Wire>) => Input
  },
): Readonly<SchemaOperation<Id, Kind, Wire, Input>>
export function defineOperation<
  const Id extends string,
  const Kind extends ControlSurfaceOperationKind,
  Wire extends z.ZodType,
>(
  definition: OperationMeta<Id, Kind> & { input: Wire; errors: readonly AppErrorCode[] },
): Readonly<SchemaOperation<Id, Kind, Wire, z.output<Wire>>>
export function defineOperation(
  definition: OperationMeta<string, ControlSurfaceOperationKind> & {
    input: z.ZodType
    errors: readonly AppErrorCode[]
    normalize?: (wire: never) => unknown
  },
) {
  return Object.freeze({
    ...definition,
    contract: 'schema' as const,
    normalize: definition.normalize ?? ((wire: unknown) => wire),
  })
}
export function defineLegacyOperation<
  const Id extends string,
  const Kind extends ControlSurfaceOperationKind,
>(definition: OperationMeta<Id, Kind>): Readonly<LegacyOperation<Id, Kind>> {
  return Object.freeze({ ...definition, contract: 'legacy' as const })
}
