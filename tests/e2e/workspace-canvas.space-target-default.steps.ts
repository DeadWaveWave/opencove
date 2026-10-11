import { expect, type Page } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pluginCli } from './plugins.commands.helpers'
import { removePathWithRetry } from './workspace-canvas.helpers'
import type { MountDto } from '../../src/shared/contracts/dto'

/** Exercise the public UI creation path, then consume its durable location through a real plugin. */
export async function verifyRemoteSpaceDefaultTarget(options: {
  window: Page
  userDataDir: string
  endpointId: string
  rootPath: string
}) {
  const { window: page } = options
  await page.getByTestId('workspace-canvas-action-bar-new-space').click()
  const readSpace = () =>
    page.evaluate(async () => {
      const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
      const state = JSON.parse(raw ?? '{}') as {
        activeWorkspaceId?: string
        workspaces?: Array<{
          id: string
          spaces: Array<{ id: string; directoryPath: string; targetMountId: string | null }>
        }>
      }
      const project = state.workspaces?.find(item => item.id === state.activeWorkspaceId)
      const space = project?.spaces[0]
      return project && space ? { projectId: project.id, ...space } : null
    })
  await expect.poll(readSpace).toMatchObject({
    directoryPath: options.rootPath,
    targetMountId: expect.any(String),
  })
  const space = (await readSpace())!
  const mounts = await page.evaluate(async projectId => {
    return window.opencoveApi.controlSurface.invoke<{ mounts: MountDto[] }>({
      kind: 'query',
      id: 'mount.list',
      payload: { projectId },
    })
  }, space.projectId)
  expect(mounts.mounts.find(item => item.mountId === space.targetMountId)?.endpointId).toBe(
    options.endpointId,
  )
  const source = await mkdtemp(join(tmpdir(), 'opencove-space-target-plugin-'))
  try {
    await writeFile(
      join(source, 'opencove.plugin.json'),
      JSON.stringify({
        apiVersion: 1,
        id: 'space-target-fixture',
        version: '1.0.0',
        displayName: 'Space target fixture',
        description: 'Checks persisted Space targets',
        main: 'main.mjs',
        contributes: {
          commands: [
            {
              id: 'inspect',
              title: 'Inspect Space',
              description: 'Read a file in its target',
              target: 'plugin',
            },
          ],
        },
      }),
    )
    await writeFile(
      join(source, 'main.mjs'),
      `export function activate({host}) {
      return { async runCommand(_command, target) {
        return { resolved: await host.target.resolve(target), file: await host.filesystem.readText({target, path:'space-target.txt'}) };
      } };
    }`,
    )
    await pluginCli(options.userDataDir, ['install', source])
    const result = await pluginCli(options.userDataDir, [
      'run',
      'space-target-fixture',
      'inspect',
      '--params',
      JSON.stringify({
        projectId: space.projectId,
        spaceId: space.id,
      }),
    ])
    expect(result).toMatchObject({
      resolved: {
        projectId: space.projectId,
        spaceId: space.id,
        mountId: space.targetMountId,
        endpointId: options.endpointId,
        workingDirectory: options.rootPath,
      },
      file: { content: 'remote Space target verified' },
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
    expect(await readSpace()).toEqual(space)
  } finally {
    await removePathWithRetry(source)
  }
}
