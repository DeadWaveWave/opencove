export function createRemoteRecoveryTerminalNode(
  nodeId: string,
  sessionId: string,
  executionDirectory: string,
) {
  return {
    id: nodeId,
    sessionId,
    title: 'Remote shell',
    position: { x: 0, y: 0 },
    width: 520,
    height: 360,
    kind: 'terminal',
    profileId: null,
    runtimeKind: 'posix',
    terminalGeometry: { cols: 80, rows: 24 },
    status: null,
    startedAt: null,
    endedAt: null,
    exitCode: null,
    lastError: null,
    scrollback: null,
    executionDirectory,
    expectedDirectory: executionDirectory,
    agent: null,
    task: null,
  }
}

export function countOccurrences(value: string, token: string): number {
  return value.split(token).length - 1
}
