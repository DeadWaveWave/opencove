export { holdPrepare, releasePrepare } from './managedClaudePreparationHold'
import type {} from '../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/testHarness'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, type Page } from '@playwright/test'

export async function syntheticRebind(
  userDataDir: string,
  home: string,
  workspace: string,
  nodeId: string,
  priorId: string,
) {
  const nextId = randomUUID()
  // The artificial provider requires a real test transcript before it will resume B.
  const directory = path.join(
    home,
    '.claude',
    'projects',
    path.resolve(workspace).replace(/[^A-Za-z0-9]/gu, '-'),
  )
  const transcript = await readFile(path.join(directory, `${priorId}.jsonl`), 'utf8')
  await writeFile(path.join(directory, `${nextId}.jsonl`), transcript.replaceAll(priorId, nextId))
  const connection = JSON.parse(
    await readFile(path.join(userDataDir, 'control-surface.json'), 'utf8'),
  ) as { hostname: string; port: number; token: string }
  const response = await fetch(
    `http://${connection.hostname}:${connection.port}/_test/managed-claude-rebind`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId, resumeSessionId: nextId }),
    },
  )
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ status: 'committed', revision: expect.any(Number) })
  return nextId
}

export async function expectConversation(page: Page, nodeId: string, resumeSessionId: string) {
  await expect
    .poll(
      () =>
        page.evaluate(
          id =>
            window.__opencoveWorkspaceCanvasTestApi
              ?.getAgentSessions()
              .find(node => node.nodeId === id)?.resumeSessionId,
          nodeId,
        ),
      { timeout: 30_000 },
    )
    .toBe(resumeSessionId)
}
