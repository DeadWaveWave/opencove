import { createTestAgentLaunchArtifactRoot } from '../../support/agentLaunchArtifactRoot'
import { access, readFile, stat } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { createAgentLaunchArtifactFile } from '../../../src/contexts/agent/infrastructure/providers/shared/AgentLaunchArtifactFile'

describe('createAgentLaunchArtifactFile', () => {
  it('writes a private config and removes its directory idempotently', async () => {
    const config = await createAgentLaunchArtifactFile(
      createTestAgentLaunchArtifactRoot(),
      'opencove-provider-test-',
      'settings.json',
      '{"private":true}',
    )

    await expect(readFile(config.path, 'utf8')).resolves.toBe('{"private":true}')
    expect((await stat(config.path)).mode & 0o777).toBe(0o600)

    await Promise.all([config.dispose(), config.dispose()])
    await config.dispose()
    await expect(access(config.path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('aggregates setup and rollback failures', async () => {
    const error = await createAgentLaunchArtifactFile(
      createTestAgentLaunchArtifactRoot(),
      'prefix-',
      'settings.json',
      '{}',
      {
        mkdir: vi.fn(async () => undefined),
        chmod: vi.fn(async () => undefined),
        mkdtemp: vi.fn(async () => '/tmp/opencove-provider-rollback'),
        rm: vi.fn(async () => await Promise.reject(new Error('rollback failed'))),
        writeFile: vi.fn(async () => await Promise.reject(new Error('setup failed'))),
      },
    ).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(AggregateError)
    expect((error as AggregateError).errors).toEqual([
      expect.objectContaining({ message: 'setup failed' }),
      expect.objectContaining({ message: 'rollback failed' }),
    ])
  })
})
