import { expect, type Page } from '@playwright/test'
import { mkdtemp, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { toFileUri } from '../../src/contexts/filesystem/domain/fileUri'
import { removePathWithRetry, seedWorkspaceState } from './workspace-canvas.helpers'
import { resetWorkspaceState } from './m6.endpoints-mounts.legacy-repair.helpers'
import { resolveE2ETmpDir } from './workspace-canvas.testUtils'
import { PIXEL_EFFECTS_ENABLED } from './workspace-canvas.pixel-effects.helpers'

export async function createDirtyDocumentFixture() {
  const repo = await realpath(
    await mkdtemp(path.join(resolveE2ETmpDir(), 'opencove-compact-document-')),
  )
  await writeFile(
    path.join(repo, 'README.md'),
    '# Glacier workspace\n\nA shared surface for parallel work.\n\n- Keep terminal sessions alive.\n- Review changes in an isolated worktree.\n- Keep documents and decisions together.\n',
  )
  return { repo, cleanup: () => removePathWithRetry(repo) }
}

export async function seedDirtyDocumentFixture(page: Page, fixture: { repo: string }) {
  const projectId = 'pixel-material-workspace'
  await seedWorkspaceState(page, {
    activeWorkspaceId: projectId,
    workspaces: [
      {
        id: projectId,
        name: 'Glacier workspace',
        path: fixture.repo,
        nodes: [],
        spaces: [
          {
            id: 'pixel-build-space',
            name: 'Build workspace',
            directoryPath: fixture.repo,
            labelColor: 'blue',
            pinned: false,
            nodeIds: [],
            rect: { x: 24, y: 42, width: 932, height: 970 },
          },
        ],
        activeSpaceId: 'pixel-build-space',
      },
    ],
    settings: {
      uiTheme: 'dark',
      ...PIXEL_EFFECTS_ENABLED,
      language: 'en',
      uiFontSize: 16,
      terminalFontSize: 14,
      defaultTerminalWindowScalePercent: 100,
      focusNodeOnClick: false,
      canvasInputMode: 'mouse',
      canvasWheelBehavior: 'zoom',
      browserDefaultMode: 'iframe',
      websiteWindowPolicy: { enabled: true },
      standbyBannerEnabled: false,
      githubPullRequestsEnabled: false,
    },
  })
  const seeded = await page.evaluate(async id => {
    const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
    if (!raw) {
      throw new Error('Document fixture workspace missing')
    }
    const state = JSON.parse(raw) as {
      workspaces: Array<{
        id: string
        nodes: unknown[]
        spaces: Array<{ nodeIds: string[]; targetMountId?: string }>
      }>
    }
    const workspace = state.workspaces.find(candidate => candidate.id === id)!
    const { mounts } = await window.opencoveApi.controlSurface.invoke<{
      mounts: Array<{ mountId: string }>
    }>({ kind: 'query', id: 'mount.list', payload: { projectId: id } })
    if (!mounts[0]) {
      throw new Error('Document fixture local mount missing')
    }
    workspace.spaces[0].targetMountId = mounts[0].mountId
    workspace.spaces[0].nodeIds = ['pixel-material-document']
    return state
  }, projectId)
  seeded.workspaces.find(workspace => workspace.id === projectId)!.nodes = [
    {
      id: 'pixel-material-document',
      title: 'README.md',
      kind: 'document',
      position: { x: 52, y: 392 },
      width: 420,
      height: 260,
      task: { uri: toFileUri(path.join(fixture.repo, 'README.md')) },
    },
  ]
  await resetWorkspaceState(page, seeded)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.locator('html')).toHaveAttribute('data-cove-theme-id', 'dark')
  await expect(page.locator('.react-flow__node')).toHaveCount(1)
  await expect(page.locator('.document-node .monaco-editor')).toBeVisible()
}
