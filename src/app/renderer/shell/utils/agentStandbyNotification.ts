export type AgentStandbyNotificationGitContext =
  | { kind: 'branch'; name: string }
  | { kind: 'detached'; head: string; shortHead: string }

export type AgentStandbyNotificationPullRequest = {
  number: number
  title: string
  url: string | null
}

/** The island shows at most this many cards; an older one beyond them is dropped. */
export const AGENT_ISLAND_MAX_CARDS = 3

/** One Agent that needs you, as its card and system notification tell it. */
export type AgentStandbyNotification = {
  kind: 'agent-standby'
  id: string
  sessionId: string
  workspaceId: string
  workspaceName: string
  workspacePath: string
  nodeId: string
  title: string
  taskId: string | null
  taskTitle: string | null
  spaceId: string | null
  spaceName: string | null
  spaceDirectoryPath: string | null
  executionDirectory: string
  gitContext: AgentStandbyNotificationGitContext | null
  pullRequest: AgentStandbyNotificationPullRequest | null
  createdAt: number
}

/** Which of a card's context chips Settings › Notifications shows. */
export type AgentStandbyCardContextVisibility = {
  showTask: boolean
  showSpace: boolean
  showBranch: boolean
  showPullRequest: boolean
}
