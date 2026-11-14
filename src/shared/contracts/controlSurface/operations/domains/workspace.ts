import * as z from 'zod'
import { defineOperation } from '../defineOperation'
import {
  normalizeAllocateProjectPlaceholderPayload,
  normalizePathPayload,
} from '../workspaceNormalize'
export const workspaceAllocateProjectPlaceholderOperation = defineOperation({
  input: z.union([
    z.object({ projectId: z.string().describe('Project identifier as a single path segment') }),
    z.array(z.unknown()),
  ]),
  normalize: normalizeAllocateProjectPlaceholderPayload,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeAllocateProjectPlaceholderPayload,
  errors: [],
  id: 'workspace.allocateProjectPlaceholder',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Create and approve a project directory under Worker user data',
})
export const workspaceApproveRootOperation = defineOperation({
  input: z.union([
    z.object({ path: z.string().describe('Absolute directory path') }),
    z.array(z.unknown()),
  ]),
  normalize: (payload: unknown) => normalizePathPayload(payload, 'workspace.approveRoot'),
  compat: 'control-surface-legacy-validation',
  legacyNormalize: (payload: unknown) => normalizePathPayload(payload, 'workspace.approveRoot'),
  errors: [],
  id: 'workspace.approveRoot',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Approve a directory root for subsequent filesystem and runtime access',
})
export const workspaceEnsureDirectoryOperation = defineOperation({
  input: z.union([
    z.object({ path: z.string().describe('Absolute directory path') }),
    z.array(z.unknown()),
  ]),
  normalize: (payload: unknown) => normalizePathPayload(payload, 'workspace.ensureDirectory'),
  compat: 'control-surface-legacy-validation',
  legacyNormalize: (payload: unknown) => normalizePathPayload(payload, 'workspace.ensureDirectory'),
  errors: ['workspace.ensure_directory_failed'],
  id: 'workspace.ensureDirectory',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Create a directory and its parents within approved roots',
})
export const workspaceOperations = [
  workspaceAllocateProjectPlaceholderOperation,
  workspaceApproveRootOperation,
  workspaceEnsureDirectoryOperation,
] as const
