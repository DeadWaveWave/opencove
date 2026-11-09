// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { runCommand } from '../../../src/platform/process/runCommand'
import { agentWaitHttpFixture } from '../../support/agentWaitHttpFixture'
import { snapshot } from './cliAgentWait.helpers'

it.each(['waiting', 'exited'] as const)(
  'real CLI returns %s on stderr and closes SSE without writing input',
  async state => {
    const f = agentWaitHttpFixture({
      ...snapshot('a', state),
      blockedReason: state === 'waiting' ? 'permission' : null,
    })
    const root = await mkdtemp(join(tmpdir(), 'opencove-wait-cli-'))
    try {
      const endpoint = await f.start()
      const result = await runCommand(
        process.execPath,
        [
          resolve('out/cli/opencove.mjs'),
          'agent',
          'wait',
          '--node',
          'a',
          '--until',
          'idle',
          '--endpoint',
          endpoint,
          '--token',
          'fixture-secret',
          '-o',
          'json',
        ],
        root,
        { timeoutMs: 5000, env: { ...process.env, OPENCOVE_USER_DATA_DIR: root } },
      )
      expect(result.exitCode, result.stderr).toBe(state === 'waiting' ? 10 : 11)
      expect(result.stdout).toBe('')
      expect(JSON.parse(result.stderr)).toMatchObject({
        error: {
          code: state === 'waiting' ? 'agent.wait_attention' : 'agent.wait_exited',
          details: {
            mode: 'all',
            until: 'idle',
            targets: [
              expect.objectContaining({ nodeId: 'a', sessionId: 'session-a', status: state }),
            ],
          },
        },
      })
      expect(result.stderr).not.toContain('fixture-secret')
      expect(
        f.requests.every(id =>
          [
            'system.capabilities',
            'system.whoami',
            'node.get',
            'node.list',
            'agent.get',
            'agent.list',
          ].includes(id),
        ),
      ).toBe(true)
      await vi.waitFor(() => expect(f.closed()).toBe(true))
    } finally {
      await f.stop()
      await rm(root, { recursive: true, force: true })
    }
  },
)
