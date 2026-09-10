import { describe, expect, it } from 'vitest'
import { resolveTerminalProviderHintFromCommand } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodesStore.terminalProviderHint'
import { ensurePersistedWorkspace } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/ensure'

describe('terminal provider paste identity', () => {
  it.each(['pi', 'kimi'])('recognizes and restores %s provider identity', provider => {
    expect(resolveTerminalProviderHintFromCommand(`${provider} --model example`)).toBe(provider)
    expect(resolveTerminalProviderHintFromCommand(`C:\\bin\\${provider}.cmd`)).toBe(provider)
    const workspace = ensurePersistedWorkspace({
      id: 'workspace',
      name: 'Workspace',
      path: '/workspace',
      nodes: [
        {
          id: 'terminal',
          title: 'Terminal',
          kind: 'terminal',
          width: 640,
          height: 360,
          position: { x: 0, y: 0 },
          terminalProviderHint: provider,
        },
      ],
    })
    expect(workspace?.nodes[0]?.terminalProviderHint).toBe(provider)
  })
})
