import { expect, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { CreateNodeResult } from '../../src/shared/contracts/dto/nodeControl'

/** Runs the real CLI inside the fake provider, inheriting that provider's genuine grant. */
export async function writeLineageAgentStub(root: string): Promise<string> {
  const path = join(root, 'lineage-agent.mjs')
  await writeFile(
    path,
    `
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { execFile } from 'node:child_process'
await writeFile(${JSON.stringify(root)} + '/' + process.env.OPENCOVE_NODE_ID + '.ready', 'ready')
const request = ${JSON.stringify(root)} + '/' + process.env.OPENCOVE_NODE_ID + '.request.json'
let busy = false
const timer = setInterval(async () => {
  if (busy) return
  busy = true
  try {
    const args = JSON.parse(await readFile(request, 'utf8'))
    await unlink(request)
    const child = execFile(process.execPath, [${JSON.stringify(resolve('out/cli/opencove.mjs'))}, ...args],
      { env: process.env, timeout: 45000 }, async (error, stdout, stderr) => {
        await writeFile(request + '.result', JSON.stringify({ code: error?.code ?? 0, stdout, stderr }))
        busy = false
      })
    await writeFile(request + '.pid', String(child.pid))
  } catch { busy = false }
}, 50)
timer.unref()
await import(${JSON.stringify(pathToFileURL(resolve('scripts/test-agent-session-stub.mjs')).href)})
`,
  )
  return path
}
export async function grantedAgentCli(root: string, nodeId: string, args: string[]) {
  const request = join(root, nodeId + '.request.json')
  const resultPath = request + '.result'
  const { rm } = await import('node:fs/promises')
  await rm(resultPath, { force: true })
  await writeFile(request, JSON.stringify(args))
  let result: { code: number; stdout: string; stderr: string } | undefined
  await expect
    .poll(
      async () => {
        try {
          result = JSON.parse(await readFile(resultPath, 'utf8'))
          return true
        } catch {
          return false
        }
      },
      { timeout: 55_000 },
    )
    .toBe(true)
  return result!
}
export async function createLineageAgent(
  page: Page,
  targetProjectId: string,
): Promise<CreateNodeResult> {
  return page.evaluate(
    async projectId =>
      window.opencoveApi.controlSurface.invoke<CreateNodeResult>({
        kind: 'command',
        id: 'node.create',
        payload: {
          kind: 'agent',
          projectId,
          title: 'Coordinator',
          data: { provider: 'claude-code', prompt: '' },
        },
      }),
    targetProjectId,
  )
}
export async function establishLineageAgentReady(
  page: Page,
  node: { id: string; sessionId?: string | null },
) {
  await page.evaluate(
    async nodeId =>
      window.opencoveApi.controlSurface.invoke({
        kind: 'command',
        id: 'canvas.focus',
        payload: { target: { kind: 'node', nodeId } },
      }),
    node.id,
  )
  await expect(page.locator(`[data-id="${node.id}"] .terminal-node`)).toContainText(
    'STRICT_READY',
    { timeout: 20_000 },
  )
  await page.evaluate(
    async binding =>
      window.opencoveApi.controlSurface.invoke({
        kind: 'command',
        id: 'session.writeNode',
        payload: { nodeId: binding.id, sessionId: binding.sessionId, data: 'manual baseline\r' },
      }),
    node,
  )
  await expect
    .poll(
      () =>
        page.evaluate(
          async id =>
            (
              await window.opencoveApi.controlSurface.invoke<{ state: string }>({
                kind: 'query',
                id: 'agent.get',
                payload: { nodeId: id },
              })
            ).state,
          node.id,
        ),
      { timeout: 20_000 },
    )
    .toBe('idle')
}
