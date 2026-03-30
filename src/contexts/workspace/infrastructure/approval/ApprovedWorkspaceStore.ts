import { app } from 'electron'
import { resolve } from 'node:path'
import {
  createApprovedWorkspaceStoreForPath,
  type ApprovedWorkspaceStore,
} from './ApprovedWorkspaceStoreCore'

export type { ApprovedWorkspaceStore } from './ApprovedWorkspaceStoreCore'

export function createApprovedWorkspaceStore(): ApprovedWorkspaceStore {
  const storePath = resolve(app.getPath('userData'), 'approved-workspaces.json')
  return createApprovedWorkspaceStoreForPath(storePath)
}
