import { createServer, type Server } from 'node:http'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { ManagedSshEndpointRuntimeAccess } from '../../../src/app/main/controlSurface/topology/topologyEndpointAccess'
import {
  buildPosixBootstrapScript,
  classifyManagedSshBootstrapFailure,
} from '../../../src/app/main/controlSurface/topology/managedSshRuntimeSupport'
import { runCommand } from '../../../src/platform/process/runCommand'
import { createManagedSshBootstrapProgressParser } from '../../../src/app/main/controlSurface/topology/managedSshBootstrapProgress'

import { afterEach, describe, expect, it } from 'vitest'

const describePosix = process.platform === 'win32' ? describe.skip : describe
const tempRoots: string[] = []

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return (server.address() as AddressInfo).port
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close(error => (error ? reject(error) : resolve()))
  })
}

async function createBrokenRuntime(home: string, managed = true): Promise<void> {
  const binDir = join(home, '.local', 'bin')
  await mkdir(binDir, { recursive: true })
  const launcherPath = join(binDir, 'opencove')
  await writeFile(
    launcherPath,
    `#!/bin/sh
${managed ? '# __OPENCOVE_CLI_WRAPPER__\n# OPENCOVE_INSTALL_OWNER=standalone\n' : ''}printf "%s\\n" "dyld: Library not loaded: Electron Framework" >&2
exit 86
`,
  )
  await chmod(launcherPath, 0o755)
}

function createAccess(remotePort: number): ManagedSshEndpointRuntimeAccess {
  return {
    endpointId: 'managed-corrupt',
    displayName: 'Corrupt Mac',
    token: 'managed-token',
    ssh: {
      host: 'example.test',
      port: 22,
      username: 'tester',
      remotePort,
      remotePlatform: 'posix',
    },
  }
}

describePosix('managed SSH POSIX bootstrap', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map(async path => await rm(path, { recursive: true })))
  })

  it('repairs the resolved managed launcher rather than only the endpoint state wrapper', async () => {
    const home = await mkdtemp(join(tmpdir(), 'opencove-bootstrap-health-'))
    tempRoots.push(home)
    await createBrokenRuntime(home)
    let installerFetchCount = 0
    const installer = `#!/bin/sh
set -eu
command -v opencove > "$HOME/repaired-target"
cat > "$HOME/.local/bin/opencove" <<'OPENCOVE_TEST_RUNTIME'
#!/bin/sh
exit 0
OPENCOVE_TEST_RUNTIME
chmod +x "$HOME/.local/bin/opencove"
printf repaired > "$HOME/repair-ran"
`
    const server = createServer((request, response) => {
      if (request.url === '/opencove-install.sh') {
        installerFetchCount += 1
        response.writeHead(200, { 'content-type': 'text/plain' })
        response.end(installer)
        return
      }

      response.writeHead(installerFetchCount > 0 ? 200 : 503, {
        'content-type': 'application/json',
      })
      response.end('{"ok":true}')
    })
    const remotePort = await listen(server)

    try {
      const script = buildPosixBootstrapScript(createAccess(remotePort), {
        installerUrl: `http://127.0.0.1:${String(remotePort)}/opencove-install.sh`,
        reinstallRuntime: true,
        devRepoRoot: null,
      })
      const phases: string[] = []
      let settled = false
      const parser = createManagedSshBootstrapProgressParser(phase => {
        expect(settled).toBe(false)
        phases.push(phase)
      })
      const result = await runCommand('sh', [], process.cwd(), {
        stdin: script,
        timeoutMs: 10_000,
        onStdout: parser.push,
        env: {
          ...process.env,
          HOME: home,
          OPENCOVE_DISABLE_MANAGED_SSH_DEV_BOOTSTRAP: '1',
        },
      })
      parser.finish()
      settled = true
      expect(phases).toEqual([
        'checking_remote_runtime',
        'checking_installation',
        'downloading_installer',
        'installing_runtime',
        'starting_runtime',
        'waiting_for_runtime',
      ])
      expect(result.exitCode, result.stderr).toBe(0)
      expect(installerFetchCount).toBe(1)
      expect(await readFile(join(home, 'repair-ran'), 'utf8')).toBe('repaired')
      expect(await readFile(join(home, 'repaired-target'), 'utf8')).toBe(
        `${join(home, '.local', 'bin', 'opencove')}\n`,
      )
    } finally {
      await close(server)
    }
  })

  it('classifies a still-corrupt runtime after exactly one repair attempt', async () => {
    const home = await mkdtemp(join(tmpdir(), 'opencove-bootstrap-corrupt-'))
    tempRoots.push(home)
    await createBrokenRuntime(home)
    let installerFetchCount = 0
    const server = createServer((request, response) => {
      if (request.url === '/opencove-install.sh') {
        installerFetchCount += 1
        response.writeHead(200, { 'content-type': 'text/plain' })
        response.end('#!/bin/sh\nexit 0\n')
        return
      }
      response.writeHead(503, { 'content-type': 'application/json' })
      response.end('{"ok":false}')
    })
    const remotePort = await listen(server)

    try {
      const script = buildPosixBootstrapScript(createAccess(remotePort), {
        installerUrl: `http://127.0.0.1:${String(remotePort)}/opencove-install.sh`,
        reinstallRuntime: false,
        devRepoRoot: null,
      })
      const result = await runCommand('sh', [], process.cwd(), {
        stdin: script,
        timeoutMs: 10_000,
        env: {
          ...process.env,
          HOME: home,
          OPENCOVE_DISABLE_MANAGED_SSH_DEV_BOOTSTRAP: '1',
        },
      })

      expect(result.exitCode).toBe(127)
      expect(installerFetchCount).toBe(1)
      expect(classifyManagedSshBootstrapFailure(result.stderr)).toBe('runtime_corrupt')
      expect(result.stderr).toContain('dyld: Library not loaded: Electron Framework')
    } finally {
      await close(server)
    }
  })

  it('classifies an installer 404 separately from runtime corruption', async () => {
    const home = await mkdtemp(join(tmpdir(), 'opencove-bootstrap-installer-'))
    tempRoots.push(home)
    let installerFetchCount = 0
    const server = createServer((_request, response) => {
      if (_request.url === '/opencove-install.sh') {
        installerFetchCount += 1
        response.writeHead(404, { 'content-type': 'text/plain' })
        response.end('missing')
        return
      }
      response.writeHead(503, { 'content-type': 'application/json' })
      response.end('{"ok":false}')
    })
    const remotePort = await listen(server)

    try {
      const script = buildPosixBootstrapScript(createAccess(remotePort), {
        installerUrl: `http://127.0.0.1:${String(remotePort)}/opencove-install.sh`,
        reinstallRuntime: false,
        devRepoRoot: null,
      })
      const result = await runCommand('sh', [], process.cwd(), {
        stdin: script,
        timeoutMs: 10_000,
        env: {
          ...process.env,
          HOME: home,
          OPENCOVE_DISABLE_MANAGED_SSH_DEV_BOOTSTRAP: '1',
        },
      })

      expect(result.exitCode).toBe(127)
      expect(installerFetchCount).toBe(1)
      expect(classifyManagedSshBootstrapFailure(result.stderr)).toBe('installer_unavailable')
      expect(result.stderr).toContain('Verify the release asset exists')
    } finally {
      await close(server)
    }
  })

  it('reuses a healthy worker before checking or replacing the local runtime command', async () => {
    const home = await mkdtemp(join(tmpdir(), 'opencove-bootstrap-reuse-'))
    tempRoots.push(home)
    await createBrokenRuntime(home)
    let installerFetchCount = 0
    const server = createServer((request, response) => {
      if (request.url === '/opencove-install.sh') {
        installerFetchCount += 1
        response.writeHead(500)
        response.end()
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"ok":true}')
    })
    const remotePort = await listen(server)

    try {
      const script = buildPosixBootstrapScript(createAccess(remotePort), {
        installerUrl: `http://127.0.0.1:${String(remotePort)}/opencove-install.sh`,
        reinstallRuntime: false,
        devRepoRoot: null,
      })
      const result = await runCommand('sh', [], process.cwd(), {
        stdin: script,
        timeoutMs: 10_000,
        env: {
          ...process.env,
          HOME: home,
          OPENCOVE_DISABLE_MANAGED_SSH_DEV_BOOTSTRAP: '1',
        },
      })

      expect(result.exitCode, result.stderr).toBe(0)
      expect(installerFetchCount).toBe(0)
      expect(await readFile(join(home, '.local', 'bin', 'opencove'), 'utf8')).toContain('dyld:')
    } finally {
      await close(server)
    }
  })

  it('refuses to replace an active command that OpenCove does not own', async () => {
    const home = await mkdtemp(join(tmpdir(), 'opencove-bootstrap-unmanaged-'))
    tempRoots.push(home)
    await createBrokenRuntime(home, false)
    let installerFetchCount = 0
    const server = createServer((request, response) => {
      if (request.url === '/opencove-install.sh') {
        installerFetchCount += 1
      }
      response.writeHead(503, { 'content-type': 'application/json' })
      response.end('{"ok":false}')
    })
    const remotePort = await listen(server)

    try {
      const script = buildPosixBootstrapScript(createAccess(remotePort), {
        installerUrl: `http://127.0.0.1:${String(remotePort)}/opencove-install.sh`,
        reinstallRuntime: false,
        devRepoRoot: null,
      })
      const result = await runCommand('sh', [], process.cwd(), {
        stdin: script,
        timeoutMs: 10_000,
        env: {
          ...process.env,
          HOME: home,
          OPENCOVE_DISABLE_MANAGED_SSH_DEV_BOOTSTRAP: '1',
        },
      })

      expect(result.exitCode).toBe(127)
      expect(installerFetchCount).toBe(0)
      expect(classifyManagedSshBootstrapFailure(result.stderr)).toBe('runtime_unmanaged')
      expect(result.stderr).toContain(join(home, '.local', 'bin', 'opencove'))
      expect(result.stderr).toContain('Refusing to replace')
    } finally {
      await close(server)
    }
  })
})
