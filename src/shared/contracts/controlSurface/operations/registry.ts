import { agentOperations } from './domains/agent'
import { authOperations } from './domains/auth'
import { canvasOperations } from './domains/canvas'
import { endpointOperations } from './domains/endpoint'
import { filesystemOperations } from './domains/filesystem'
import { gitWorktreeOperations } from './domains/gitWorktree'
import { integrationOperations } from './domains/integration'
import { mountOperations } from './domains/mount'
import { mountTargetOperations } from './domains/mountTarget'
import { nodeOperations } from './domains/node'
import { noteOperations } from './domains/note'
import { pluginOperations } from './domains/plugin'
import { projectOperations } from './domains/project'
import { ptyOperations } from './domains/pty'
import { sessionOperations } from './domains/session'
import { spaceOperations } from './domains/space'
import { syncOperations } from './domains/sync'
import { systemOperations } from './domains/system'
import { workerOperations } from './domains/worker'
import { workspaceOperations } from './domains/workspace'
import { worktreeOperations } from './domains/worktree'
export const CONTROL_SURFACE_OPERATIONS = Object.freeze([
  ...agentOperations,
  ...authOperations,
  ...canvasOperations,
  ...endpointOperations,
  ...filesystemOperations,
  ...gitWorktreeOperations,
  ...integrationOperations,
  ...mountOperations,
  ...mountTargetOperations,
  ...nodeOperations,
  ...noteOperations,
  ...pluginOperations,
  ...projectOperations,
  ...ptyOperations,
  ...sessionOperations,
  ...spaceOperations,
  ...syncOperations,
  ...systemOperations,
  ...workerOperations,
  ...workspaceOperations,
  ...worktreeOperations,
] as const)
const byId = new Map<string, (typeof CONTROL_SURFACE_OPERATIONS)[number]>()
for (const operation of CONTROL_SURFACE_OPERATIONS) {
  if (byId.has(operation.id)) {
    throw new Error(`Duplicate control surface operation: ${operation.id}`)
  }
  byId.set(operation.id, operation)
}
export function getControlSurfaceOperation(id: string) {
  return byId.get(id)
}
