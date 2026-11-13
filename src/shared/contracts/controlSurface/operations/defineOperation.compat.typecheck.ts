// @compat-file control-surface-legacy-validation
// Compile-time test: `pnpm check` fails when one of the `@ts-expect-error` lines below stops
// failing, that is when a legacy hook can again be declared without a registry entry.
import * as z from 'zod'
import { defineLegacyOperation, defineOperation } from './defineOperation'

const meta = {
  id: 'typecheck.compat',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Compile-time check only.',
} as const

defineOperation({
  ...meta,
  input: z.string(),
  errors: [],
  normalize: value => value,
  legacyNormalize: value => value,
  compat: 'control-surface-legacy-validation',
})

// @ts-expect-error legacyNormalize needs a compat id
defineOperation({
  ...meta,
  input: z.string(),
  errors: [],
  normalize: value => value,
  legacyNormalize: value => value,
})

// @ts-expect-error compat must name an id from compatRegistry.json
defineOperation({
  ...meta,
  input: z.string(),
  errors: [],
  normalize: value => value,
  legacyNormalize: value => value,
  compat: 'no-such-entry' as string,
})

// @ts-expect-error defineLegacyOperation needs a compat id
defineLegacyOperation(meta)

// @ts-expect-error compat must name an id from compatRegistry.json
defineLegacyOperation({ ...meta, compat: 'no-such-entry' as string })
