import * as z from 'zod'
// @compat control-surface-legacy-validation
// Legacy normalization inspects these values shallowly. Do not recursively validate
// ignored contents or reject numeric overflow produced by JSON.parse (e.g. 1e400).
export const legacyValue = z.unknown().optional()
export const branchModeWire = z.object({
  kind: z.string().describe('Use new or existing; surrounding whitespace is trimmed'),
  name: z.string().describe('Branch name; surrounding whitespace is trimmed'),
  // @compat control-surface-legacy-validation
  startPoint: legacyValue.describe(
    'Starting revision required for a new branch; ignored for an existing branch',
  ),
})
