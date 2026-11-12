import {
  CONTROL_SURFACE_OPERATIONS,
  getControlSurfaceOperation,
} from '../../../src/shared/contracts/controlSurface/operations'

// Independent S1a acceptance oracle. Never select cases from SESSION_GRANT_POLICY.
const requiredIds = [
  'session.writeNode',
  'sync.writeState',
  'sync.writeWorkspaceStateRaw',
  'sync.writeNodeScrollback',
  'sync.writeAgentNodePlaceholderScrollback',
  'sync.state',
  'sync.readWorkspaceStateRaw',
  'session.attachAgentStateWatcher',
  'session.detachAgentStateWatcher',
  'session.prepareOrRevive',
  'workspace.allocateProjectPlaceholder',
  'workspace.ensureDirectory',
  'plugin.command.run',
  'plugin.invoke',
  'plugin.host.request',
  'plugin.sidebar.items',
  'plugin.storage.set',
  'plugin.preferences.set',
  'plugin.view.preferences.set',
  // Additional authority paths established by the S1a implementation audit.
  'plugin.view.open',
  'plugin.window.open',
] as const satisfies readonly (typeof CONTROL_SURFACE_OPERATIONS)[number]['id'][]

const denied = new Set<string>(requiredIds)
for (const op of CONTROL_SURFACE_OPERATIONS) {
  if (op.scope === 'admin' || op.id.startsWith('auth.') || op.id.startsWith('worker.')) {
    denied.add(op.id)
  }
}
export const REQUIRED_SESSION_GRANT_DENIALS = [...denied].map(id => {
  const op = getControlSurfaceOperation(id)
  if (!op) {
    throw new Error(`Required session grant denial is absent from the registry: ${id}`)
  }
  return op
})
