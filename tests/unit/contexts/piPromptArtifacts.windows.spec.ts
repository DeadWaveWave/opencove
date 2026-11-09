// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { PiAgentProviderContribution } from '../../../src/contexts/agent/infrastructure/providers/pi/PiAgentProviderContribution'
import { createManagedAgentLaunchPlan } from '../../../src/contexts/agent/application/use-cases/createManagedAgentLaunchPlan'
import { TerminalProfileResolver } from '../../../src/platform/terminal/TerminalProfileResolver'
import { rollbackAgentLaunchArtifacts } from '../../../src/contexts/agent/application/services/AgentLaunchArtifactOwner'

const file = vi.hoisted(() => ({ path: '', dispose: vi.fn(async () => {}) }))
vi.mock(
  '../../../src/contexts/agent/infrastructure/providers/shared/TemporaryProviderConfig',
  () => ({
    createTemporaryProviderConfig: async () => file,
  }),
)
afterEach(() => {
  vi.clearAllMocks()
})
const resolver = new TerminalProfileResolver({
  platform: 'win32',
  env: () => ({}),
  homeDir: () => 'C:\\Users\\fixture',
  processCwd: () => 'C:\\project',
  locateWindowsCommands: async () => [],
  listWslDistros: async () => ['Ubuntu'],
})
for (const prompt of ['--approve', '--continue']) {
  it.each([
    ['C:\\Temp\\prompt folder\\prompt.txt', 'wsl:Ubuntu', '/mnt/c/Temp/prompt folder/prompt.txt'],
    ['\\\\wsl.localhost\\Ubuntu\\tmp\\prompt.txt', 'wsl:Ubuntu', '/tmp/prompt.txt'],
    ['\\\\wsl$\\ubuntu\\tmp\\prompt.txt', 'wsl:Ubuntu', '/tmp/prompt.txt'],
    ['C:\\Temp\\prompt.txt', 'powershell', 'C:\\Temp\\prompt.txt'],
    ['C:\\Temp\\prompt.txt', ' WSL:Ubuntu ', '/mnt/c/Temp/prompt.txt'],
    ['C:\\Temp\\prompt.txt', 'wsl:RemovedDistro', 'C:\\Temp\\prompt.txt'],
  ])(
    'maps prompt file %s through %s without converting its contents to options',
    async (path, profileId, expected) => {
      file.path = path
      const managed = await createManagedAgentLaunchPlan(new PiAgentProviderContribution(), {
        profileId,
        mode: 'new',
        prompt,
        model: null,
        resumeSessionId: null,
        agentFullAccess: false,
        workspaceDirectory: 'C:\\project',
      })
      try {
        expect(managed.plan.args).toEqual([`@${path}`])
        const spawn = await resolver.resolveCommandSpawn({
          cwd: 'C:\\project',
          profileId,
          command: managed.plan.command,
          args: [...managed.plan.args],
          fileArguments: managed.plan.fileArguments,
        })
        expect(spawn.args.join(' ')).toContain(`@${expected}`)
      } finally {
        await managed.artifacts.dispose()
      }
      expect(file.dispose).toHaveBeenCalledOnce()
    },
  )
}
it.each([
  '\\\\wsl.localhost\\Debian\\tmp\\prompt.txt',
  '/var/folders/host/prompt.txt',
  '/tmp/host/prompt.txt',
  'prompt.txt',
])('rejects unreachable host file %s and rolls back the artifact', async path => {
  file.path = path
  const managed = await createManagedAgentLaunchPlan(new PiAgentProviderContribution(), {
    profileId: 'wsl:Ubuntu',
    mode: 'new',
    prompt: '--approve',
    model: null,
    resumeSessionId: null,
    agentFullAccess: false,
    workspaceDirectory: 'C:\\project',
  })
  await expect(
    resolver
      .resolveCommandSpawn({
        cwd: 'C:\\project',
        profileId: 'wsl:Ubuntu',
        command: managed.plan.command,
        args: [...managed.plan.args],
        fileArguments: managed.plan.fileArguments,
      })
      .catch(error => rollbackAgentLaunchArtifacts(error, managed.artifacts)),
  ).rejects.toThrow('cannot open an input file in this WSL profile')
  expect(file.dispose).toHaveBeenCalledOnce()
})
