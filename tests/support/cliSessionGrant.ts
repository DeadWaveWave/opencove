/* eslint-disable no-await-in-loop -- Each request checks a separate authorization boundary. */
import { expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { jsonOutput } from '../e2e/cli.terminal.helpers'
import { deniedLaunchFields } from './sessionGrantCases'

export async function assertGrantLaunchPolicy(options: {
  footprint: () => Promise<unknown>
  spaceId: string
  root: string
  command: (...args: string[]) => Promise<string>
  object: (...args: string[]) => Promise<Record<string, unknown>>
}): Promise<void> {
  const { footprint, spaceId, root, command, object } = options
  const before = await footprint()
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
  for (const [field, value] of Object.entries(deniedLaunchFields)) {
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
  expect(await footprint()).toEqual(before)
}

export const projectId = 'grant-project',
  spaceId = 'grant-main',
  worktreeSpace = 'grant-worktree'
const quote = (value: string) =>
  `'${value.replaceAll("'", process.platform === 'win32' ? "''" : `'"'"'`)}'`
export const cli = (...args: string[]) => ['opencove', ...args.map(quote)].join(' ')

export function grantCliCommands(command: (...args: string[]) => Promise<string>) {
  const success = async (...args: string[]) => {
    const output = await command(...args)
    expect(output, args.join(' ')).toMatch(/\bexit=0\b/)
    return output
  }
  const object = async (...args: string[]) => jsonOutput(await success(...args))
  return { success, object }
}

export async function assertDeniedGrantApi(options: {
  command: (...args: string[]) => Promise<string>
  root: string
  id: string
  input: unknown
}) {
  const { command, root, id, input } = options
  const inputPath = join(root, `${id}.json`)
  await writeFile(inputPath, JSON.stringify(input))
  const denied = await command('api', 'call', id, '--input-file', inputPath, '-o', 'json')
  expect(denied).toMatch(/\bexit=4\b/)
  expect(denied.replaceAll('\n', '')).toContain(
    id === 'session.launchAgent' ? 'node_create_required' : 'operation_denied',
  )
}

export async function assertHumanDecisionDenied(options: {
  command: (...args: string[]) => Promise<string>
  root: string
  agentNode: { id: string; sessionId: string }
}) {
  const { command, agentNode } = options
  expect(
    (await command('agent', 'prompt', '--node', agentNode.id, '--text', 'Approve it')).replaceAll(
      '\n',
      '',
    ),
  ).toContain('agent.blocked')
  await assertDeniedGrantApi({
    ...options,
    id: 'session.writeNode',
    input: { nodeId: agentNode.id, sessionId: agentNode.sessionId, data: 'yes\r' },
  })
}
