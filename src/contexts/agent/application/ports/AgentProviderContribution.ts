import type {
  AgentLaunchMode,
  AgentHookInstallState,
  AgentProviderAvailability,
  AgentProviderId,
} from '../../../../shared/contracts/dto'
import type { TerminalAgentHookContext } from '../../../../shared/runtime/agentHook/agentHookChannel'

export interface AgentProviderPermissionConfiguration {
  readonly arguments?: readonly string[]
  readonly environment?: Readonly<Record<string, string>>
}

export interface AgentProviderLaunchConfiguration {
  readonly defaultArguments: readonly string[]
  readonly defaultEnvironment: Readonly<Record<string, string>>
  readonly executable: string
  readonly permission?: AgentProviderPermissionConfiguration
}

export interface AgentProviderDescriptor {
  readonly displayName: string
  readonly documentationUrl: string
  readonly id: AgentProviderId
  readonly launch: AgentProviderLaunchConfiguration
}

export interface AgentProviderDetector {
  inspect(executablePathOverride?: string | null): Promise<AgentProviderAvailability>
}

export interface AgentRuntimeArtifact {
  dispose(): Promise<void>
}

export interface AgentLaunchArtifactRegistrar {
  track<TArtifact extends AgentRuntimeArtifact>(label: string, artifact: TArtifact): TArtifact
}

export interface AgentLaunchPlan {
  readonly args: readonly string[]
  readonly command: string
  readonly effectiveModel: string | null
  readonly env: Readonly<NodeJS.ProcessEnv>
  readonly launchMode: AgentLaunchMode
  readonly hookInstallState?: AgentHookInstallState
  readonly onStarted?: (sessionId: string) => void
  readonly resumeSessionId: string | null
}

export interface CreateAgentLaunchPlanCommand {
  readonly profileId?: string | null
  readonly agentFullAccess: boolean
  readonly artifacts: AgentLaunchArtifactRegistrar
  readonly executablePathOverride?: string | null
  readonly mode: AgentLaunchMode
  readonly model: string | null
  readonly opencodeServer?: {
    readonly hostname: string
    readonly port: number
  } | null
  readonly prompt?: string
  readonly resumeSessionId: string | null
  readonly workspaceDirectory: string
}

export interface AgentLaunchPlanner {
  createLaunchPlan(command: CreateAgentLaunchPlanCommand): Promise<AgentLaunchPlan>
}

export interface AgentHookInjectionPlan {
  readonly args: readonly string[]
  readonly env: Readonly<NodeJS.ProcessEnv>
  readonly hookInstallState: AgentHookInstallState
  readonly onStarted?: (sessionId: string, terminalActivity?: TerminalAgentHookContext) => void
}

export interface PrepareAgentHookInjectionCommand {
  readonly artifacts: AgentLaunchArtifactRegistrar
  readonly environment?: Readonly<NodeJS.ProcessEnv>
  readonly executablePathOverride?: string | null
  readonly workspaceDirectory: string
}

export interface AgentHookInjectionPlanner {
  prepareHookInjection(command: PrepareAgentHookInjectionCommand): Promise<AgentHookInjectionPlan>
}

export interface AgentProviderContribution {
  readonly descriptor: AgentProviderDescriptor
  readonly detector: AgentProviderDetector
  readonly hookInjection?: AgentHookInjectionPlanner
  readonly launcher: AgentLaunchPlanner
}
