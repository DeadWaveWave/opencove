import { testWorkspacePath } from './workspace-canvas.helpers'

export const createRailAgent = (
  id: string,
  title: string,
  x: number,
  prompt: string,
  startedAt: string,
) => ({
  id,
  title,
  position: { x, y: 0 },
  width: 320,
  height: 240,
  kind: 'agent' as const,
  status: 'running' as const,
  startedAt,
  agent: {
    provider: 'codex' as const,
    prompt,
    model: 'gpt-5.2-codex',
    effectiveModel: 'gpt-5.2-codex',
    launchMode: 'new' as const,
    resumeSessionId: null,
    executionDirectory: testWorkspacePath,
    expectedDirectory: testWorkspacePath,
    directoryMode: 'workspace' as const,
    customDirectory: null,
    shouldCreateDirectory: false,
  },
})
