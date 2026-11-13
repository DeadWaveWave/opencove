/* eslint-disable no-await-in-loop -- Each request checks a separate authorization boundary. */
import { expect, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PersistedAppStateContract } from '../../src/shared/contracts/persistedAppState'
import { canvasRuntimeFootprint } from './cli.terminal.helpers'

export async function assertGrantLaunchPolicy(options: {
  page: Page
  projectId: string
  spaceId: string
  root: string
  command: (...args: string[]) => Promise<string>
  object: (...args: string[]) => Promise<Record<string, unknown>>
}): Promise<void> {
  const { page, projectId, spaceId, root, command, object } = options
  const before = await canvasRuntimeFootprint(page, projectId)
  for (const id of ['session.launchAgent', 'session.launchAgentInMount']) {
    const schema = await object('api', 'schema', id)
    expect(schema).toMatchObject({
      access: 'constrained',
      policyVersion: 's1d-v3',
      rejectedFields: {
        env: expect.any(String),
        executablePathOverride: expect.any(String),
        resumeSessionId: expect.any(String),
        codexReuseRunningAppServer: expect.any(String),
        mode: expect.any(String),
      },
    })
    expect(schema.rejectedFields).not.toHaveProperty('agentFullAccess')
  }
  // CLI raw session launches are refused before dispatch. Check forbidden data through
  // the admitted node.create entry point; contract tests cover the inner field_denied policy.
  for (const [field, value] of Object.entries({
    env: null,
    executablePathOverride: null,
    resumeSessionId: null,
    codexReuseRunningAppServer: false,
    mode: 'new',
    futureOverride: false,
  })) {
    const inputPath = join(root, 'refused-launch.json')
    await writeFile(
      inputPath,
      JSON.stringify({
        kind: 'agent',
        space: { kind: 'spaceId', spaceId },
        data: { provider: 'claude-code', prompt: 'Review this project', [field]: value },
      }),
    )
    const denied = await command(
      'api',
      'call',
      'node.create',
      '--input-file',
      inputPath,
      '-o',
      'json',
    )
    expect(denied, field).toMatch(/\bexit=2\b/)
    const error = denied.replaceAll('\n', '')
    expect(error).toContain('unrecognized_keys')
    expect(error).toContain(`"${field}"`)
  }
  expect(await canvasRuntimeFootprint(page, projectId)).toEqual(before)
}

export async function assertFullAccessChoice(page: Page, nodeId: string): Promise<void> {
  const permission = await page.evaluate(async id => {
    const { state } = await window.opencoveApi.persistence.readAppState()
    const saved = state as PersistedAppStateContract<{ agentFullAccess: boolean }>
    const agentNode = saved.workspaces
      .flatMap(workspace => workspace.nodes)
      .find(node => node.id === id)
    return { setting: saved.settings.agentFullAccess, explicit: agentNode?.agent?.agentFullAccess }
  }, nodeId)
  expect(permission).toEqual({ setting: false, explicit: true })
}
