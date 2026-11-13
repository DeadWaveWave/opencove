// @vitest-environment node
import { execSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { agentSpawnErrorPresentation } from '../../../src/shared/errors/agentSpawnError'

it.runIf(process.platform === 'win32')(
  'passes the bare node UUID through a real cmd.exe recovery command',
  async () => {
    const nodeId = '11111111-1111-4111-8111-111111111111'
    const hint = agentSpawnErrorPresentation({
      code: 'agent.spawn_concurrency_limit',
      details: {
        nodes: [{ nodeId, title: 'Reviewer', kind: 'agent', depth: 2, state: 'running' }],
      },
    })!.hint
    const command = hint.slice(hint.indexOf('opencove agent stop --node ')).replace(/\.$/, '')
    const root = await mkdtemp(join(tmpdir(), 'opencove-cmd-recovery-'))
    try {
      // Capture cmd's actual positional arguments, including any literal single quotes.
      await writeFile(join(root, 'opencove.cmd'), '@echo off\r\necho [%~1][%~2][%~3][%~4]\r\n')
      const stdout = execSync(command, {
        cwd: root,
        shell: process.env.ComSpec || 'cmd.exe',
        encoding: 'utf8',
        timeout: 10000,
      })
      expect(stdout.trim()).toBe(`[agent][stop][--node][${nodeId}]`)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
)
