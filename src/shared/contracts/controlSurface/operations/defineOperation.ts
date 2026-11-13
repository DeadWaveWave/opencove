import type * as z from 'zod'
import type { AppErrorCode } from '../../dto'
import type { ControlSurfaceOperationKind } from '../../controlSurface'
import type { CompatId } from '../../../compat/compatId'

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
  // @compat control-surface-legacy-validation
  /** Migration hook: inspect raw keys and reproduce legacy errors. Cannot override schema rejection. */
  legacyNormalize?: (payload: unknown) => Input
  // @compat control-surface-legacy-validation
  /** Registry entry that says why `legacyNormalize` exists and when it expires. */
  compat?: CompatId
}
// @compat control-surface-legacy-validation
export interface LegacyOperation<
  Id extends string,
  Kind extends ControlSurfaceOperationKind,
> extends OperationMeta<Id, Kind> {
  contract: 'legacy'
  compat: CompatId
}
// @compat control-surface-legacy-validation
/** A legacy hook is only accepted together with the registry entry that bounds its lifetime. */
type LegacyNormalizeDefinition<Input> =
  | { legacyNormalize?: undefined; compat?: undefined }
  | { legacyNormalize: (payload: unknown) => Input; compat: CompatId }
// @compat control-surface-legacy-validation
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
  } & LegacyNormalizeDefinition<Input>,
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
    // @compat control-surface-legacy-validation
    legacyNormalize?: (payload: unknown) => unknown
    // @compat control-surface-legacy-validation
    compat?: CompatId
  },
) {
  return Object.freeze({
    ...definition,
    contract: 'schema' as const,
    normalize: definition.normalize ?? ((wire: unknown) => wire),
  })
}
// @compat control-surface-legacy-validation
export function defineLegacyOperation<
  const Id extends string,
  const Kind extends ControlSurfaceOperationKind,
>(definition: OperationMeta<Id, Kind> & { compat: CompatId }): Readonly<LegacyOperation<Id, Kind>> {
  return Object.freeze({ ...definition, contract: 'legacy' as const })
}
