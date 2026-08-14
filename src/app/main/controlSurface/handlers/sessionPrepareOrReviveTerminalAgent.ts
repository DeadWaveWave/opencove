import {
  buildTerminalAgentReentryCommand,
  enterTerminalAgentInFreshPty,
} from '../../../../contexts/agent/application/terminalAgentPtyReexec'
import { normalizeResumeSessionBinding } from '../../../../contexts/agent/domain/agentResumeBinding'
import type { ControlSurfacePtyRuntime } from './sessionPtyRuntime'
import type { NormalizedPersistedNode } from './sessionPrepareOrReviveShared'

export async function reenterTerminalAgent(options: {
  node: NormalizedPersistedNode
  sessionId: string
  ptyRuntime: Pick<ControlSurfacePtyRuntime, 'waitForShellReady' | 'write'>
}): Promise<void> {
  const binding = normalizeResumeSessionBinding(options.node.agent)
  const hintedBinding = normalizeResumeSessionBinding({
    provider: options.node.terminalProviderHint,
    resumeSessionId: null,
    resumeSessionIdVerified: false,
  })
  const provider = binding?.provider ?? hintedBinding?.provider
  if (!provider) {
    return
  }

  await enterTerminalAgentInFreshPty({
    sessionId: options.sessionId,
    command: buildTerminalAgentReentryCommand({
      provider,
      resumeSessionId: binding?.resumeSessionIdVerified === true ? binding.resumeSessionId : null,
    }),
    waitForShellReady: async () => {
      await options.ptyRuntime.waitForShellReady?.(options.sessionId)
    },
    write: async input => {
      await Promise.resolve(options.ptyRuntime.write(input.sessionId, input.data))
    },
  })
}
