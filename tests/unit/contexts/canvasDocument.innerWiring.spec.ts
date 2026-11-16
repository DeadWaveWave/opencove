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

  // The collapse actions and the menu actions (arrange, note to task) write the nodes and the
  // Spaces in one update and read the document themselves (#702, PR 9).
  it.each(['useCanvasCollapse', 'useWorkspaceCanvasMenuActions'])(
    'passes the writer to %s and none of the retired channels',
    name => {
      const call = callOf(name)
      expect(call).toMatch(/\bupdateCanvasDocument:\s*nodeStore\.updateCanvasDocument\b/)
      expect(call).not.toMatch(
        /\b(nodesRef|spacesRef|setNodes|onSpacesChange|onRequestPersistFlush)\b/,
      )
    },
  )

  it('hands the whole node store to the explorer', () => {
    expect(callOf('useCanvasSpaceExplorer')).toMatch(/[{,\s]nodeStore[,\s}]/)
  })

  it('hands the whole node store to the Providers', () => {
    expect(propsOf('WorkspaceCanvasProviders')).toMatch(/\bnodeStore=\{nodeStore\}/)
  })
})
