// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { describe, expect, it } from 'vitest'
import {
  runManagedSshBootstrap,
  buildSshTunnelArgs,
} from '../../../src/app/main/controlSurface/topology/managedSshRuntimeSupport'
import { runCommand } from '../../../src/platform/process/runCommand'
import type { ManagedSshEndpointRuntimeAccess } from '../../../src/app/main/controlSurface/topology/topologyEndpointAccess'

const host = process.env.OPENCOVE_TEST_MANAGED_SSH_HOST
const directory = process.env.OPENCOVE_MANAGED_SSH_ARTIFACT_DIR

describe.skipIf(!host || !directory)('standalone managed runtime over real SSH', () => {
  it('installs the target bundle, authenticates, and reconnects to the same instance', async () => {
    const endpointId = `smoke-${randomUUID()}`
    const runtimeBuild = JSON.parse(await readFile(join(directory!, 'runtime-build.json'), 'utf8'))
    const remotePort = await runCommand(
      'ssh',
      [
        host!,
        'python3',
        '-c',
        '\'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])\'',
      ],
      process.cwd(),
      { timeoutMs: 10_000 },
    )
    expect(remotePort.exitCode).toBe(0)
    const access: ManagedSshEndpointRuntimeAccess = {
      endpointId,
      displayName: 'isolated SSH smoke',
      token: randomBytes(32).toString('base64url'),
      ssh: {
        host: host!,
        username: null,
        port: null,
        remotePort: Number(remotePort.stdout.trim()),
        remotePlatform: 'posix',
      },
    }
    const server = createServer()
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
    const localPort = (server.address() as { port: number }).port
    await new Promise<void>(done => server.close(() => done()))
    const tunnel = spawn(
      'ssh',
      buildSshTunnelArgs(access, [
        '-N',
        '-o',
        'ExitOnForwardFailure=yes',
        '-L',
        `${localPort}:127.0.0.1:${access.ssh.remotePort}`,
      ]),
      { windowsHide: true, stdio: 'ignore' },
    )
    const invoke = async (id: string, payload: unknown = null) => {
      const response = await fetch(`http://127.0.0.1:${localPort}/invoke`, {
        method: 'POST',
        headers: { authorization: `Bearer ${access.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          kind:
            id.endsWith('.status') ||
            id.startsWith('system.') ||
            ['session.snapshot', 'filesystem.readDirectory'].includes(id)
              ? 'query'
              : 'command',
          id,
          payload,
        }),
        signal: AbortSignal.timeout(5_000),
      })
      expect(response.status).toBe(200)
      const envelope = await response.json()
      expect(envelope.ok).toBe(true)
      return envelope.value
    }
    let instanceId: string | null = null
    let sessionId: string | null = null
    try {
      await runManagedSshBootstrap('ssh', access, { runtimeBuild, operationId: randomUUID() })
      const first = await invoke('system.capabilities')
      instanceId = first.instanceId
      expect(first.runtimeBuild).toEqual(runtimeBuild)
      expect(first.deploymentId).toBe(endpointId)
      expect(first.runtimeReady).toBe(true)
      expect((await invoke('worker.maintenance.status')).phase).toBe('active')
      const cwd = `/tmp/${endpointId}`
      await invoke('workspace.approveRoot', { path: cwd })
      await invoke('workspace.ensureDirectory', { path: cwd })
      await invoke('filesystem.readDirectory', { uri: `file://${cwd}` })
      const terminal = await invoke('pty.spawn', {
        cwd,
        command: '/bin/sh',
        args: ['-c', 'printf OPENCOVE_SSH_PTY_READY; exec /bin/sh'],
        cols: 80,
        rows: 24,
      })
      sessionId = terminal.sessionId
      await expect
        .poll(async () => JSON.stringify(await invoke('session.snapshot', { sessionId })))
        .toContain('OPENCOVE_SSH_PTY_READY')
      expect(
        (await invoke('worker.maintenance.acquire', { instanceId, lease: randomUUID() })).acquired,
      ).toBe(false)
      await runManagedSshBootstrap('ssh', access, { runtimeBuild, operationId: randomUUID() })
      expect((await invoke('system.capabilities')).instanceId).toBe(instanceId)
    } finally {
      if (sessionId) {
        await invoke('session.kill', { sessionId })
      }
      if (instanceId) {
        const payload = { instanceId, lease: randomUUID() }
        await expect
          .poll(async () => (await invoke('worker.maintenance.acquire', payload)).acquired)
          .toBe(true)
        await invoke('worker.maintenance.stop', payload)
      }
      tunnel.kill()
    }
  }, 600_000)
})
