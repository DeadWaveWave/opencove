import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

export async function createDebugUserDataDir(prefix) {
  return await mkdtemp(path.join(tmpdir(), prefix))
}

export async function seedApprovedLocalWorkerUserData(userDataDir, workspacePath) {
  await mkdir(userDataDir, { recursive: true })
  await writeFile(
    path.join(userDataDir, 'approved-workspaces.json'),
    `${JSON.stringify({ version: 1, roots: [workspacePath] })}\n`,
    'utf8',
  )
  await writeFile(
    path.join(userDataDir, 'home-worker.json'),
    `${JSON.stringify({
      version: 1,
      mode: 'local',
      remote: null,
      webUi: {
        enabled: false,
        port: null,
        exposeOnLan: false,
        passwordHash: null,
      },
      updatedAt: new Date().toISOString(),
    })}\n`,
    'utf8',
  )
}

export function createSingleWorkspaceState({
  workspaceId,
  spaceId,
  name,
  workspacePath,
  settings,
}) {
  return {
    formatVersion: 1,
    activeWorkspaceId: workspaceId,
    workspaces: [
      {
        id: workspaceId,
        name,
        path: workspacePath,
        worktreesRoot: '',
        pullRequestBaseBranchOptions: [],
        environmentVariables: {},
        spaceArchiveRecords: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        isMinimapVisible: true,
        spaces: [
          {
            id: spaceId,
            name: 'Main',
            directoryPath: workspacePath,
            targetMountId: null,
            labelColor: null,
            nodeIds: [],
            rect: null,
          },
        ],
        activeSpaceId: spaceId,
        nodes: [],
      },
    ],
    settings,
  }
}
