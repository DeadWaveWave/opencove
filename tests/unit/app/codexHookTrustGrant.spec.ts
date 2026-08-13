import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { grantManagedCodexHookTrust } from '../../../src/app/main/controlSurface/agentHook/codexHookTrustGrant'

const roots: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('managed hook trust grant', () => {
  it('never records a fallback file write as reusable live RPC trust', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'opencove-trust-ledger-'))
    roots.push(runtimeHome)
    const entries = [
      {
        eventName: 'SessionStart',
        command: "if [ -f '/tmp/hook.sh' ]; then /bin/sh '/tmp/hook.sh'; fi",
        timeoutSeconds: 10,
        sourcePath: join(runtimeHome, 'hooks.json'),
      },
    ]
    const options = {
      runtimeHome,
      executable: process.execPath,
      entries,
      entryPath: join(runtimeHome, 'missing-trust-entry.mjs'),
    }

    await expect(grantManagedCodexHookTrust(options)).resolves.toMatchObject({ lane: 'fallback' })
    await expect(access(join(runtimeHome, 'trust-grant-ledger.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await expect(grantManagedCodexHookTrust(options)).resolves.toMatchObject({
      lane: 'fallback',
    })

    const configPath = join(runtimeHome, 'config.toml')
    const config = await readFile(configPath, 'utf8')
    await writeFile(configPath, config.replace(/sha256:[a-f0-9]{64}/u, `sha256:${'0'.repeat(64)}`))
    await expect(grantManagedCodexHookTrust(options)).resolves.toMatchObject({ lane: 'fallback' })
  })
})
