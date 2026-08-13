import {
  buildTerminalAgentReentryCommand,
  reexecTerminalAgentInPty,
} from '../../../../contexts/agent/application/terminalAgentPtyReexec'
import {
  isResumeSessionBindingVerified,
  normalizeResumeSessionBinding,
} from '../../../../contexts/agent/domain/agentResumeBinding'
import type { ControlSurfacePtyRuntime } from './sessionPtyRuntime'
import type { NormalizedPersistedNode } from './sessionPrepareOrReviveShared'

export async function reenterVerifiedTerminalAgent(options: {
  node: NormalizedPersistedNode
  sessionId: string
  ptyRuntime: Pick<ControlSurfacePtyRuntime, 'write'>
}): Promise<void> {
  const binding = normalizeResumeSessionBinding(options.node.agent)
  if (!binding || !isResumeSessionBindingVerified(binding)) {
    return
  }

  await reexecTerminalAgentInPty({
    sessionId: options.sessionId,
    command: buildTerminalAgentReentryCommand({
      provider: binding.provider,
      resumeSessionId: binding.resumeSessionId,
    }),
    write: async input => {
      await Promise.resolve(options.ptyRuntime.write(input.sessionId, input.data))
    },
    waitForDropBack: async () => true,
  })
}
