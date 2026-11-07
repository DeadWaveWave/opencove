import * as z from 'zod'
import { normalizeSystemCapabilities, normalizeSystemPing } from '../systemHandlersNormalize'
import { defineLegacyOperation, defineOperation } from '../defineOperation'
export const systemCapabilitiesOperation = defineOperation({
  input: z
    .unknown()
    .describe(
      'Legacy system.capabilities wire payload; normalization preserves the existing accept-domain.',
    ),
  normalize: normalizeSystemCapabilities,
  errors: [],
  id: 'system.capabilities',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Get protocol features, build identity and runtime readiness',
})
export const systemHomeDirectoryOperation = defineLegacyOperation({
  id: 'system.homeDirectory',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Get the Worker home directory, hostname and platform',
})
export const systemPingOperation = defineOperation({
  input: z
    .unknown()
    .describe(
      'Legacy system.ping wire payload; normalization preserves the existing accept-domain.',
    ),
  normalize: normalizeSystemPing,
  errors: [],
  id: 'system.ping',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Check Worker reachability and return its time and process id',
})
export const systemOperationsOperation = defineOperation({
  id: 'system.operations',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'List the operations registered in this Worker runtime',
  input: z.object({}),
  errors: [],
})
export const systemOperationDescribeOperation = defineOperation({
  id: 'system.operation.describe',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Describe a registered operation and its JSON input schema',
  input: z.object({ id: z.string() }),
  errors: [],
})
export const systemOperations = [
  systemOperationsOperation,
  systemOperationDescribeOperation,
  systemCapabilitiesOperation,
  systemHomeDirectoryOperation,
  systemPingOperation,
] as const
