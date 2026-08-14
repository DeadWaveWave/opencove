import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readSshConfigHosts } from '../../../src/app/main/controlSurface/topology/sshConfigReader'

const tempRoots: string[] = []

async function createFixture(): Promise<{ root: string; configPath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'opencove-ssh-config-'))
  tempRoots.push(root)
  const sshDirectory = join(root, '.ssh')
  await mkdir(sshDirectory)
  return { root, configPath: join(sshDirectory, 'config') }
}

describe('readSshConfigHosts', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  })

  it('returns an empty list when the root config does not exist', async () => {
    const { configPath } = await createFixture()

    await expect(readSshConfigHosts({ configPath })).resolves.toEqual([])
  })

  it('fails closed with a stable warning when reading is denied', async () => {
    const { configPath } = await createFixture()
    const warn = vi.fn()
    await writeFile(configPath, 'Host secret')

    await expect(
      readSshConfigHosts({
        configPath,
        warn,
        readFile: async () => {
          throw new Error('EACCES /sensitive/home/.ssh/config')
        },
      }),
    ).resolves.toEqual([])
    expect(warn).toHaveBeenCalledWith('Unable to read an SSH configuration file; skipping it.')
    expect(warn.mock.calls.flat().join(' ')).not.toContain('/sensitive/home')
  })

  it('skips a file larger than the per-file limit', async () => {
    const { configPath } = await createFixture()
    await writeFile(configPath, `Host too-large\n#${'x'.repeat(1024 * 1024)}`)

    await expect(readSshConfigHosts({ configPath, warn: vi.fn() })).resolves.toEqual([])
  })

  it('expands nested Includes and breaks realpath-normalized cycles', async () => {
    const { configPath } = await createFixture()
    const includePath = join(configPath, '..', 'included.conf')
    await writeFile(configPath, 'Include included.conf\nHost root-host')
    await writeFile(includePath, 'Include config\nHost included-host')

    await expect(readSshConfigHosts({ configPath })).resolves.toEqual([
      { alias: 'included-host', hostName: null, user: null, port: null },
      { alias: 'root-host', hostName: null, user: null, port: null },
    ])
  })

  it('caps a glob Include at 256 matching files', async () => {
    const { configPath } = await createFixture()
    const includesDirectory = join(configPath, '..', 'config.d')
    await mkdir(includesDirectory)
    await Promise.all(
      Array.from({ length: 257 }, async (_, index) => {
        const suffix = String(index).padStart(3, '0')
        await writeFile(join(includesDirectory, `${suffix}.conf`), `Host host-${suffix}`)
      }),
    )
    await writeFile(configPath, 'Include config.d/*.conf')

    const hosts = await readSshConfigHosts({ configPath, warn: vi.fn() })
    expect(hosts).toHaveLength(256)
    expect(hosts[0]?.alias).toBe('host-000')
    expect(hosts.at(-1)?.alias).toBe('host-255')
  })
})
