// @vitest-environment node
import { access, readFile, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { PiAgentProviderContribution } from '../../../src/contexts/agent/infrastructure/providers/pi/PiAgentProviderContribution'
import { createManagedAgentLaunchPlan } from '../../../src/contexts/agent/application/use-cases/createManagedAgentLaunchPlan'
import type { TemporaryProviderConfig } from '../../../src/contexts/agent/infrastructure/providers/shared/TemporaryProviderConfig'
const files = vi.hoisted(() => [] as TemporaryProviderConfig[])
vi.mock(
  '../../../src/contexts/agent/infrastructure/providers/shared/TemporaryProviderConfig',
  async importOriginal => {
    const actual =
      await importOriginal<
        typeof import('../../../src/contexts/agent/infrastructure/providers/shared/TemporaryProviderConfig')
      >()
    return {
      ...actual,
      createTemporaryProviderConfig: async (
        ...args: Parameters<typeof actual.createTemporaryProviderConfig>
      ) => {
        const file = await actual.createTemporaryProviderConfig(...args)
        files.push(file)
        return file
      },
    }
  },
)
afterEach(async () => {
  await Promise.all(files.splice(0).map(file => file.dispose()))
  vi.clearAllMocks()
})
const input = {
  mode: 'new' as const,
  prompt: '--continue',
  model: null,
  resumeSessionId: null,
  agentFullAccess: false,
  workspaceDirectory: '/fixture',
}
it.each(['--continue', '--approve'])(
  'keeps hook arguments before prompt %j and retires both artifacts',
  async prompt => {
    const dispose = vi.fn(async () => {})
    const commit = vi.fn()
    const provider = new PiAgentProviderContribution({
      channel: {
        reserveSpawn: async () => ({
          usesHook: true,
          installState: 'installed',
          env: {},
          commit,
          dispose,
        }),
      } as never,
    })
    const managed = await createManagedAgentLaunchPlan(provider, { ...input, prompt })
    const promptFile = files[0].path
    const extensionFile = files[1].path
    try {
      expect(managed.plan.args).toEqual(['-e', extensionFile, `@${promptFile}`])
      expect(managed.plan.fileArguments).toEqual([{ index: 2, prefix: '@' }])
      expect(await readFile(promptFile, 'utf8')).toBe(prompt)
      if (process.platform !== 'win32') {
        expect((await stat(dirname(promptFile))).mode & 0o777).toBe(0o700)
      }
      managed.plan.onStarted?.('child')
      expect(commit).toHaveBeenCalledWith('child')
    } finally {
      await managed.artifacts.dispose()
    }
    await expect(access(promptFile)).rejects.toThrow()
    await expect(access(extensionFile)).rejects.toThrow()
    expect(dispose).toHaveBeenCalledOnce()
  },
)
it('rolls back the prompt file if later hook preparation fails', async () => {
  const provider = new PiAgentProviderContribution({
    channel: {
      reserveSpawn: async () => {
        throw new Error('Fixture reservation failed')
      },
    } as never,
  })
  await expect(createManagedAgentLaunchPlan(provider, input)).rejects.toThrow(
    'Fixture reservation failed',
  )
  expect(files).toHaveLength(1)
  await expect(access(files[0].path)).rejects.toThrow()
})
