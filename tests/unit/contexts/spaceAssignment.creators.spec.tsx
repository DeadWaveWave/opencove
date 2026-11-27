// #758's precondition, at its source: every creator of the real node store has written its node to
// the document when it returns (sync) or resolves (async). The Space assignment reads the node from
// the document, so a creator whose write came later would make the assignment a no-op.
import { act } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import { readWorkspaceDocument } from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  createCanvasDocumentHarness,
  renderCanvasNodeStore,
} from '../../support/canvasDocumentHarness'
import { CREATIONS } from '../../support/nodeStoreCreations'

vi.mock('@contexts/plugins/presentation/renderer/usePluginRegistry', () => ({
  getPluginManifest: (pluginId: string) => ({
    id: pluginId,
    enabled: true,
    nodeKinds: ['plugin'],
    view: { minWidth: 100, minHeight: 100 },
  }),
}))

describe.each(Object.keys(CREATIONS))('the creator of %s', name => {
  it('has written the node to the document when it returns', async () => {
    const harness = createCanvasDocumentHarness()
    const view = renderCanvasNodeStore(harness)
    let heldAtReturn: boolean | null = null
    let createdId: string | null = null
    await act(async () => {
      const returned = CREATIONS[name](view.result.current as never)
      if (returned && typeof (returned as Promise<unknown>).then === 'function') {
        // The callers continue right after the await: read there, nothing in between.
        const node = (await returned) as Node<TerminalNodeData> | null
        createdId = node?.id ?? null
      } else {
        createdId = (returned as Node<TerminalNodeData> | null)?.id ?? null
      }
      heldAtReturn =
        createdId !== null &&
        (readWorkspaceDocument(harness.workspaceId)?.nodes.some(n => n.id === createdId) ?? false)
    })
    expect(createdId).not.toBeNull()
    expect(heldAtReturn).toBe(true)
  })
})
