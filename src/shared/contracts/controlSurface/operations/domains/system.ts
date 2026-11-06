import * as z from 'zod'
import { defineLegacyOperation, defineOperation } from '../defineOperation'
export const systemCapabilitiesOperation = defineLegacyOperation({
  id: 'system.capabilities',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Perform system capabilities.',
})
export const systemHomeDirectoryOperation = defineLegacyOperation({
  id: 'system.homeDirectory',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Perform system home Directory.',
})
export const systemPingOperation = defineLegacyOperation({
  id: 'system.ping',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Perform system ping.',
})
export const systemOperationsOperation = defineOperation({
  id: 'system.operations',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'List operations registered in this runtime.',
  input: z.object({}),
  errors: [],
})
export const systemOperationDescribeOperation = defineOperation({
  id: 'system.operation.describe',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Describe a registered operation and its wire input schema.',
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
