import { parseArgs } from '../../fixtures/provider-argv/pi.mjs'
// @vitest-environment node
import { access } from 'node:fs/promises'
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
it.each(['Explain the change', 'Refactor'])(
  'keeps hook arguments before prompt %j and retires the hook artifact',
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
    const extensionFile = files[0].path
    try {
      expect(managed.plan.args).toEqual(['-e', extensionFile, prompt])
      expect(managed.plan.fileArguments).toBeUndefined()
      expect(parseArgs(managed.plan.args).messages).toEqual([prompt])
      expect(parseArgs(managed.plan.args).fileArgs).toEqual([])
      managed.plan.onStarted?.('child')
      expect(commit).toHaveBeenCalledWith('child')
    } finally {
      await managed.artifacts.dispose()
    }
    await expect(access(extensionFile)).rejects.toThrow()
    expect(dispose).toHaveBeenCalledOnce()
  },
)
it.each(['--continue', '--approve', 'config', 'update', '@file'])(
  'refuses %j before reserving hooks or creating files',
  async prompt => {
    const reserveSpawn = vi.fn()
    const provider = new PiAgentProviderContribution({ channel: { reserveSpawn } as never })
    await expect(
      createManagedAgentLaunchPlan(provider, { ...input, prompt }),
    ).rejects.toMatchObject({ details: { reason: 'initial_prompt_unsupported' } })
    expect(reserveSpawn).not.toHaveBeenCalled()
    expect(files).toHaveLength(0)
  },
)
