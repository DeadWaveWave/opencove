import { createAppError } from '../../errors/appError'

export type ControlSurfaceClientFeatures = { managedClaudeResumeBindingV1?: true }
export const MANAGED_CLAUDE_CLIENT_FEATURES = { managedClaudeResumeBindingV1: true } as const

export function normalizeClientFeatures(value: unknown): ControlSurfaceClientFeatures | undefined {
  if (value === undefined) {
    return undefined
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ('managedClaudeResumeBindingV1' in value && value.managedClaudeResumeBindingV1 !== true)
  ) {
    throw createAppError('common.invalid_input')
  }
  return 'managedClaudeResumeBindingV1' in value ? MANAGED_CLAUDE_CLIENT_FEATURES : {}
}

/** Lifecycle entry points whose nested invocations need the caller's acknowledgement. */
const managedClaudeLifecycleEntries = new Set([
  'node.create',
  'session.launchAgent',
  'session.launchAgentInMount',
  'session.prepareOrRevive',
  'session.kill',
  'session.stopNode',
])
export function clientFeaturesForOperation(id: string): ControlSurfaceClientFeatures | undefined {
  return managedClaudeLifecycleEntries.has(id) ? MANAGED_CLAUDE_CLIENT_FEATURES : undefined
}
