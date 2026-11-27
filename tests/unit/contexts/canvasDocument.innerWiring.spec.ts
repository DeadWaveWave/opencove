import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The hooks that carry the document writer of the node store from `WorkspaceCanvasInner` to the
// callers of the push-away (#702, PR 6). The specs that render the whole canvas pin the hand-offs
// to the agent support, the task UI, the interactions and the role UI by behaviour. The three
// below need much more setup, so they are pinned by the source: the shortcut actions take the
// writer as an argument, the explorer and the Providers take the whole node store.
const INNER = 'src/contexts/workspace/presentation/renderer/components/WorkspaceCanvasInner.tsx'
const source = readFileSync(INNER, 'utf8')

function callOf(name: string): string {
  const start = source.indexOf(`${name}({`)
  expect(start, `${name} is called in Inner`).toBeGreaterThan(-1)
  let depth = 0
  for (let index = start + name.length; index < source.length; index += 1) {
    if (source[index] === '(') {
      depth += 1
    } else if (source[index] === ')') {
      depth -= 1
      if (depth === 0) {
        return source.slice(start, index + 1)
      }
    }
  }
  throw new Error(`${name} call is not closed`)
}

function propsOf(component: string): string {
  const start = source.indexOf(`<${component}`)
  expect(start, `${component} is rendered in Inner`).toBeGreaterThan(-1)
  return source.slice(start, source.indexOf('\n    >', start))
}

describe('Inner hands the document writer of its node store to the hooks that need it', () => {
  it('passes the writer to the shortcut actions', () => {
    expect(callOf('useWorkspaceCanvasShortcutActions')).toMatch(
      /\bupdateCanvasDocument:\s*nodeStore\.updateCanvasDocument\b/,
    )
  })

  // The collapse actions write the nodes and the Spaces in one update and read the document
  // themselves (#702, PR 9).
  it('passes the writer to useCanvasCollapse and none of the retired channels', () => {
    const call = callOf('useCanvasCollapse')
    expect(call).toMatch(/\bupdateCanvasDocument:\s*nodeStore\.updateCanvasDocument\b/)
    expect(call).not.toMatch(
      /\b(nodesRef|spacesRef|setNodes|onSpacesChange|onRequestPersistFlush)\b/,
    )
  })

  // The menu actions (arrange, note to task) get the writer from the context and the settings
  // through the reader, so Inner passes neither (S7, PR 4).
  it('passes the menu actions the settings reader and no writer, setting or retired channel', () => {
    const call = callOf('useWorkspaceCanvasMenuActions')
    expect(call).toMatch(/\breadAgentSettings\b/)
    expect(call).not.toMatch(
      /\b(updateCanvasDocument|standardWindowSizeBucket|focusNodeTargetZoom|nodesRef|spacesRef|setNodes|onSpacesChange|onRequestPersistFlush)\b/,
    )
  })

  // The agent support and the runtime integrations read the document through their own readers
  // and flush through the document commands (#702, PR 10). Inner keeps `setNodes` for the writes.
  it.each(['useWorkspaceCanvasAgentSupport', 'useWorkspaceCanvasRuntimeIntegrations'])(
    'passes none of the retired channels to %s',
    name => {
      expect(callOf(name)).not.toMatch(
        /\b(nodesRef|spacesRef|onSpacesChange|onRequestPersistFlush)\b/,
      )
    },
  )

  // The task UI and the role UI read the document through their own readers and flush through the
  // document commands or on their writes (#702, PR 11). Inner keeps `setNodes` for the writes, and
  // no longer hands the role UI the canvas state it read the Spaces from.
  it.each(['useWorkspaceCanvasTaskUi', 'useWorkspaceCanvasRoleUi'])(
    'passes none of the retired channels to %s',
    name => {
      expect(callOf(name)).not.toMatch(
        /\b(nodesRef|spacesRef|onSpacesChange|onRequestPersistFlush)\b/,
      )
    },
  )

  it('does not hand the role UI the canvas state', () => {
    expect(callOf('useWorkspaceCanvasRoleUi')).not.toMatch(/\bcanvasState\b/)
  })

  // The explorer, the filesystem nodes and the document navigation read the document through their
  // own readers and flush on their writes or through the document commands (#702, PR 12). Inner
  // hands them the node store for the writers and no ref or flush callback.
  it('passes none of the retired channels to the explorer', () => {
    expect(callOf('useCanvasSpaceExplorer')).not.toMatch(
      /\b(nodesRef|spacesRef|onSpacesChange|onRequestPersistFlush)\b/,
    )
  })

  // The node store reads the nodes and Spaces it needs through its own reader and flushes on its
  // writes or through the document commands (#702, PR 13). Inner hands it the canvas view's nodes
  // for the commit path and no Spaces ref or flush callback.
  it('passes the node store neither the Spaces ref nor the flush callback', () => {
    expect(callOf('useWorkspaceCanvasNodesStore')).not.toMatch(
      /\b(nodesRef|spacesRef|onSpacesChange|onRequestPersistFlush)\b/,
    )
  })

  // The directory ops write nodes and Spaces in one update through the node store's writer, read
  // the document themselves and flush on their write (#702, PR 14); the node types read through
  // the reader of the canvas store provider, and the shortcut actions take no Spaces.
  it('passes the directory ops the writer and none of the retired channels', () => {
    const call = callOf('useWorkspaceCanvasSpaceDirectoryOps')
    expect(call).toMatch(/\bupdateCanvasDocument:\s*nodeStore\.updateCanvasDocument\b/)
    expect(call).not.toMatch(
      /\b(nodesRef|spacesRef|setNodes|onSpacesChange|onRequestPersistFlush)\b/,
    )
  })

  it('does not hand the node types the canvas state', () => {
    expect(callOf('useWorkspaceCanvasComposedNodeTypes')).not.toMatch(/\bcanvasState\b/)
  })

  it('hands the shortcut actions no Spaces', () => {
    expect(callOf('useWorkspaceCanvasShortcutActions')).not.toMatch(/\bspaces\b/)
  })

  it('names none of the retired channels anywhere, and takes no flush prop', () => {
    expect(source).not.toMatch(/\b(spacesRef|onSpacesChange|onRequestPersistFlush)\b/)
    expect(source).not.toMatch(/\breplaceWorkspaceSpaces\b/)
  })

  it('passes none of the retired channels to the Providers', () => {
    expect(propsOf('WorkspaceCanvasProviders')).not.toMatch(
      /\b(nodesRef|spacesRef|onSpacesChange|onRequestPersistFlush)\b/,
    )
  })

  it('hands the whole node store to the explorer', () => {
    expect(callOf('useCanvasSpaceExplorer')).toMatch(/[{,\s]nodeStore[,\s}]/)
  })

  it('hands the whole node store to the Providers', () => {
    expect(propsOf('WorkspaceCanvasProviders')).toMatch(/\bnodeStore=\{nodeStore\}/)
  })
})

// The preview of a Space drag is in the `interaction` slice and the flow host reads it there
// (#738, PR 6): the Space drag hook returns only its pointer handler, and Inner keeps no preview.
describe('Inner keeps no Space drag preview', () => {
  it('names neither the preview nor a setter of it', () => {
    expect(source).not.toMatch(/\b(spaceFramePreview|spaceDragFramePreview|setSpaceFramePreview)\b/)
  })

  it('takes only the pointer handler from the Space drag hook', () => {
    expect(source).toMatch(
      /const \{ handleSpaceDragHandlePointerDown \} =\s+\w+\.useWorkspaceCanvasSpaceDrag\(/,
    )
  })
})
