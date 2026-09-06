// @vitest-environment node
import { createServer } from 'node:http'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import {
  buildPosixBootstrapScript,
  shellQuote,
} from '../../../src/app/main/controlSurface/topology/managedSshBootstrapScripts'
import { runCommand } from '../../../src/platform/process/runCommand'
import { runtimeBuildFixture } from '../../helpers/runtimeBuild'

const posix = process.platform === 'win32' ? describe.skip : describe
const endpoint = {
  endpointId: 'fixture',
  displayName: 'Fixture',
  token: '--credential-fixture',
  ssh: {
    host: 'fixture.invalid',
    port: 22,
    username: null,
    remotePort: 45001,
    remotePlatform: 'posix' as const,
  },
}

posix('managed SSH POSIX deployment bootstrap', () => {
  it('uses the fixed managed CLI without invoking a legacy global wrapper', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opencove-posix-bootstrap-'))
    const legacy = join(root, '.local/bin/opencove')
    await mkdir(join(root, '.local/bin'), { recursive: true })
    await writeFile(legacy, '#!/bin/sh\ntouch "$HOME/legacy-was-invoked"\nexit 1\n')
    await chmod(legacy, 0o755)
    const helper = join(root, 'runtime.cjs')
    await writeFile(
      helper,
      `const fs = require('node:fs');
if (process.argv[3] === 'inspect') console.log(JSON.stringify(${JSON.stringify(runtimeBuildFixture)}));
else fs.writeFileSync(process.env.HOME + '/request.json', fs.readFileSync(0));`,
    )
    const launcher = `#!/bin/sh\n# __OPENCOVE_CLI_WRAPPER__\nexec ${shellQuote(process.execPath)} ${shellQuote(helper)} "$@"\n`
    let downloads = 0
    const server = createServer((_request, response) => {
      downloads += 1
      response.end(
        `#!/bin/sh\nset -eu\nmkdir -p "$OPENCOVE_BIN_DIR"\ncat > "$OPENCOVE_BIN_DIR/opencove" <<'FIXTURE'\n${launcher}FIXTURE\nchmod +x "$OPENCOVE_BIN_DIR/opencove"\n`,
      )
    })
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
    try {
      const script = buildPosixBootstrapScript(endpoint, {
        runtimeBuild: runtimeBuildFixture,
        installerUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/installer.sh`,
        reinstallRuntime: false,
      })
      const result = await runCommand('sh', [], root, {
        stdin: script,
        timeoutMs: 10_000,
        env: {
          ...process.env,
          HOME: root,
          XDG_STATE_HOME: join(root, 'state'),
          XDG_DATA_HOME: join(root, 'data'),
        },
      })
      expect(result.exitCode, result.stderr).toBe(0)
      expect(downloads).toBe(1)
      expect(JSON.parse(await readFile(join(root, 'request.json'), 'utf8'))).toMatchObject({
        runtimeBuild: runtimeBuildFixture,
        token: endpoint.token,
      })
      expect(
        await access(join(root, 'legacy-was-invoked')).then(
          () => true,
          () => false,
        ),
      ).toBe(false)
      expect(result.stdout).not.toContain(endpoint.token)
      expect(await readFile(legacy, 'utf8')).toContain('legacy-was-invoked')
    } finally {
      server.closeAllConnections()
      await new Promise<void>(done => server.close(() => done()))
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reports a missing development artifact without running the historical worker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opencove-posix-development-'))
    try {
      const script = buildPosixBootstrapScript(endpoint, {
        runtimeBuild: { ...runtimeBuildFixture, channel: 'dev' },
        installerUrl: 'https://invalid.test/installer.sh',
        reinstallRuntime: false,
        devRepoRoot: '/root/opencove-wsl-deploy',
      })
      const result = await runCommand('sh', [], root, {
        stdin: script,
        timeoutMs: 5_000,
        env: { ...process.env, HOME: root, XDG_STATE_HOME: join(root, 'state') },
      })
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('OPENCOVE_MANAGED_SSH_ARTIFACT_DIR')
      expect(result.stderr).not.toContain('did not become ready')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
