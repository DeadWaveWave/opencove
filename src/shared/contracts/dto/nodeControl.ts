import type { AgentProviderId } from './agent'
import type { AppErrorDescriptor } from './error'
import type { TerminalRuntimeKind } from './terminal'
import type { WebsiteWindowSessionMode } from './websiteWindow'

export type ManagedCanvasNodeKind = 'note' | 'task' | 'website' | 'agent' | 'terminal'

export type UpdatableCanvasNodeKind = 'note' | 'task' | 'website'

export type NodeTaskPriority = 'low' | 'medium' | 'high' | 'urgent'

export type NodeTaskStatus = 'todo' | 'doing' | 'ai_done' | 'done'

export type SpaceLocator =
  | { kind: 'spaceId'; spaceId: string }
  | { kind: 'spaceName'; name: string; projectId?: string | null }
  | { kind: 'workerBranch'; worker: string; branch: string; projectId?: string | null }
  | { kind: 'workerPath'; worker: string; path: string; projectId?: string | null }

export interface SpaceResolutionCandidate {
  spaceId: string
  spaceName: string
  projectId: string
  worker: {
    endpointId: string
    displayName: string
  }
  directoryPath: string
  matchReason: string
  branch?: string | null
}

export interface CanvasNodeFrameDto {
  x: number
  y: number
  width: number
  height: number
}

export interface CanvasNodeSummaryDto {
  id: string
  kind: ManagedCanvasNodeKind
  title: string
  projectId: string
  spaceId: string | null
  frame: CanvasNodeFrameDto
  status?: string | null
  sessionId?: string | null
}

export type CanvasNodeDetailDataDto =
  | {
      kind: 'note'
      text: string
    }
  | {
      kind: 'task'
      requirement: string
      status: NodeTaskStatus
      priority: NodeTaskPriority
      tags: string[]
      linkedAgentNodeId: string | null
    }
  | {
      kind: 'website'
      url: string
      pinned: boolean
      sessionMode: WebsiteWindowSessionMode
      profileId: string | null
    }
  | {
      kind: 'agent'
      provider: AgentProviderId | string | null
      prompt: string
      model: string | null
      effectiveModel: string | null
      executionDirectory: string | null
      expectedDirectory: string | null
      taskId: string | null
    }
  | {
      kind: 'terminal'
      profileId: string | null
      runtimeKind: TerminalRuntimeKind | null
      executionDirectory: string | null
      expectedDirectory: string | null
    }

export interface CanvasNodeDetailDto extends CanvasNodeSummaryDto {
  data: CanvasNodeDetailDataDto
}

export interface ListNodesInput {
  space?: SpaceLocator | null
  projectId?: string | null
  kind?: ManagedCanvasNodeKind | null
}

export interface ListNodesResult {
  projectId: string | null
  spaceId: string | null
  nodes: CanvasNodeSummaryDto[]
}

export interface GetNodeInput {
  nodeId: string
}

export interface GetNodeResult {
  node: CanvasNodeDetailDto
}

export interface CreateNodeInput {
  kind: ManagedCanvasNodeKind
  space: SpaceLocator
  title?: string | null
  frame?: Partial<CanvasNodeFrameDto> | null
  data?: unknown
}

export interface CreateNodeResult {
  revision: number
  projectId: string
  spaceId: string
  node: CanvasNodeDetailDto
}

export interface UpdateNodeInput {
  kind: UpdatableCanvasNodeKind
  nodeId: string
  title?: string | null
  frame?: Partial<CanvasNodeFrameDto> | null
  data?: unknown
}

export interface UpdateNodeResult {
  revision: number
  node: CanvasNodeDetailDto
}

export interface DeleteNodeInput {
  nodeId: string
}

export interface DeleteNodeResult {
  revision: number
  projectId: string
  spaceId: string | null
  nodeId: string
  runtimeCleanup: {
    attempted: boolean
    ok: boolean
  }
}

export type CanvasFocusTargetInput =
  | { kind: 'node'; nodeId: string }
  | { kind: 'space'; locator: SpaceLocator }

export type CanvasFocusEventTarget =
  | { kind: 'node'; nodeId: string; spaceId: string | null }
  | { kind: 'space'; spaceId: string }

export interface CanvasFocusInput {
  target: CanvasFocusTargetInput
}

export interface CanvasFocusResult {
  projectId: string
  target: CanvasFocusEventTarget
  deliveredClientCount: number
  delivered: boolean
}

export interface CreateNodeCliResult {
  node: CreateNodeResult
  focus: CanvasFocusResult | null
  focusError?: AppErrorDescriptor | null
}
