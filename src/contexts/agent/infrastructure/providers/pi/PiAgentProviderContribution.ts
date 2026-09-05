import type {
  AgentLaunchPlan,
  AgentProviderDetector,
  CreateAgentLaunchPlanCommand,
  AgentHookInjectionPlanner,
} from '../../../application/ports/AgentProviderContribution'
import {
  TerminalCliAgentProviderContribution,
  type TerminalCliAgentProviderOptions,
} from '../terminal-cli/TerminalCliContribution'

import type { AgentHookChannel } from '../../../../../shared/runtime/agentHook/agentHookChannel'
import { createTemporaryProviderConfig } from '../shared/TemporaryProviderConfig'
import { piAgentStatusExtensionSource } from './PiAgentStatusExtension'

const piLaunch = {
  defaultArguments: [],
  defaultEnvironment: {},
  executable: 'pi',
} as const

export class PiAgentProviderContribution extends TerminalCliAgentProviderContribution {
  readonly descriptor = {
    displayName: 'Pi',
    documentationUrl: 'https://pi.dev',
    id: 'pi',
    launch: piLaunch,
  } as const

  readonly hookInjection: AgentHookInjectionPlanner
  private readonly channel?: AgentHookChannel

  constructor(
    options: {
      readonly detector?: AgentProviderDetector
      readonly channel?: AgentHookChannel
    } = {},
  ) {
    super('pi', piLaunch.executable, options satisfies TerminalCliAgentProviderOptions)
    this.channel = options.channel
    this.hookInjection = {
      prepareHookInjection: async command => {
        if (!this.channel) {
          return { args: [], env: {}, hookInstallState: 'not_installed' }
        }
        const reservation = await this.channel.reserveSpawn()
        if (!reservation.usesHook) {
          return { args: [], env: {}, hookInstallState: reservation.installState }
        }
        command.artifacts.track('pi-hook-reservation', reservation)
        try {
          const extension = await createTemporaryProviderConfig(
            'opencove-pi-hook-',
            'status.ts',
            piAgentStatusExtensionSource,
          )
          command.artifacts.track('pi-hook-extension', extension)
          return {
            args: ['-e', extension.path],
            env: reservation.env ?? {},
            hookInstallState: reservation.installState,
            onStarted: reservation.commit,
          }
        } catch {
          await reservation.dispose()
          return { args: [], env: {}, hookInstallState: 'error' }
        }
      },
    }
  }

  protected override async createTerminalLaunchPlan(
    command: CreateAgentLaunchPlanCommand,
  ): Promise<AgentLaunchPlan> {
    const model = normalizeOptionalValue(command.model)
    const resumeSessionId = normalizeOptionalValue(command.resumeSessionId)
    const telemetry = command.profileId?.startsWith('wsl:')
      ? { args: [], env: {}, hookInstallState: 'skipped' as const, onStarted: undefined }
      : this.channel
        ? await this.hookInjection.prepareHookInjection(command)
        : null
    const args: string[] = [...(telemetry?.args ?? [])]

    if (model) {
      args.push('--model', model)
    }
    if (command.mode === 'resume') {
      args.push(resumeSessionId ? '--session' : '--continue')
      if (resumeSessionId) {
        args.push(resumeSessionId)
      }
    } else {
      const prompt = command.prompt?.trim() ?? ''
      if (prompt.length > 0) {
        args.push(prompt)
      }
    }

    return {
      args,
      command: piLaunch.executable,
      effectiveModel: model,
      env: telemetry?.env ?? {},
      ...(telemetry
        ? { hookInstallState: telemetry.hookInstallState, onStarted: telemetry.onStarted }
        : {}),
      launchMode: command.mode,
      resumeSessionId: command.mode === 'resume' ? resumeSessionId : null,
    }
  }
}

function normalizeOptionalValue(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? ''
  return normalized.length > 0 ? normalized : null
}
