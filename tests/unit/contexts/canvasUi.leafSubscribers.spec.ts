import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const CANVAS_DIR = 'src/contexts/workspace/presentation/renderer/components/workspaceCanvas/'
const CANVAS_STATE_HOOK = 'hooks/useCanvasState.ts'
const SPACE_OVERLAY = 'view/WorkspaceSpaceRegionsOverlay.tsx'
const REMOVED_NAMES = [
  'selectedSpaceIdsRef',
  'dragSelectedSpaceIdsRef',
  'setSelectedSpaceIds',
  'setSortedSelectedSpaceIds',
  'selectedNodeIdsRef',
  'setSelectedNodeIds',
]
const DRAFT_OVERLAY = 'view/WorkspaceSelectionDraftOverlay.tsx'
const CANVAS_MENUS = 'view/WorkspaceCanvasMenus.tsx'
const STORE_DIR = 'src/contexts/workspace/presentation/renderer/store/'
const STORE_CONTEXT = `${STORE_DIR}canvasStoreContext.tsx`
const HOOKS_DIR = 'src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/'

// Decision 7 of #685: only leaf components subscribe to the canvas `ui` slice. Hooks called by
// WorkspaceCanvasInner read it at call time (`useReadCanvasUi`) and write through commands.
describe('canvas UI subscriptions', () => {
  it('no hook under workspaceCanvas/hooks calls useCanvasUi', () => {
    const files = execFileSync('git', ['ls-files', HOOKS_DIR], { encoding: 'utf8' })
      .split('\n')
      .filter(file => /\.tsx?$/.test(file) && !/\.spec\./.test(file))
    expect(files.length).toBeGreaterThan(20)

    const offenders = files.filter(file => /\buseCanvasUi\(/.test(readFileSync(file, 'utf8')))

    expect(offenders).toEqual([])
  })

  // Decision 5 of #692: `useCanvasState` (nodeIds, for flowNodes) and the Space overlay
  // (spaceIds) are the only subscribers of the `selection` slice.
  // Scans every tracked source file, so a subscription in WorkspaceCanvasInner or anywhere else
  // fails too.
  it('useCanvasSelection is called only by useCanvasState and the Space overlay', () => {
    const files = execFileSync('git', ['ls-files', 'src'], { encoding: 'utf8' })
      .split('\n')
      .filter(file => /\.tsx?$/.test(file) && !/\.(spec|test)\./.test(file))
    expect(files.length).toBeGreaterThan(1000)

    const callers = files.filter(file => /\buseCanvasSelection\(/.test(readFileSync(file, 'utf8')))

    expect(callers.map(file => file.slice(CANVAS_DIR.length)).sort()).toEqual(
      [CANVAS_STATE_HOOK, SPACE_OVERLAY].sort(),
    )
  })

  // `flowNodes` needs the node ids during render. A subscription to anything else in
  // `useCanvasState` (the Space ids, or the whole slice) would render WorkspaceCanvasInner on every
  // Space selection change.
  it('useCanvasState subscribes only to the selected node ids', () => {
    const source = readFileSync(`${CANVAS_DIR}${CANVAS_STATE_HOOK}`, 'utf8')

    const calls = source.match(/\buseCanvasSelection\(/g) ?? []
    const nodeIdCalls =
      source.match(/\buseCanvasSelection\(\s*(\w+)\s*=>\s*\1\.nodeIds\s*,?\s*\)/g) ?? []

    expect(calls).toHaveLength(1)
    expect(nodeIdCalls).toHaveLength(1)
  })

  it('no tracked source file under src names the removed selection refs and setters', () => {
    const files = execFileSync('git', ['ls-files', 'src'], { encoding: 'utf8' })
      .split('\n')
      .filter(file => /\.(ts|tsx|mjs|css)$/.test(file))
    expect(files.length).toBeGreaterThan(500)

    const names = new RegExp(`\\b(${REMOVED_NAMES.join('|')})\\b`)
    const offenders = files.filter(file => names.test(readFileSync(file, 'utf8')))

    expect(offenders).toEqual([])
  })
})

function trackedSourceFiles(): string[] {
  const files = execFileSync('git', ['ls-files', 'src'], { encoding: 'utf8' })
    .split('\n')
    .filter(file => /\.tsx?$/.test(file) && !/\.(spec|test)\./.test(file))
  expect(files.length).toBeGreaterThan(1000)
  return files
}

/** The names a file imports from the store context, as exported (aliases and `type` removed). */
function namesImportedFromStoreContext(source: string): string[] {
  return [...source.matchAll(/import\s+\{([^}]*)\}\s*from\s*'[^']*\/canvasStoreContext'/g)].flatMap(
    match =>
      match[1]
        .split(',')
        .map(
          specifier =>
            specifier
              .trim()
              .replace(/^type\s+/, '')
              .split(/\s+as\s+/)[0],
        )
        .filter(Boolean),
  )
}

// Decision 2 of #738: the subscribers of the `interaction` slice are leaves. So far they are the
// marquee rectangle and the context menu's snapping toggle; the host and the guides join them in
// later pull requests of S6. Hooks read the slice at call time (`useReadCanvasInteraction`).
describe('canvas interaction subscriptions', () => {
  // By import, not by call text: a type argument (`useCanvasInteraction<boolean>(`) or an alias
  // (`import { useCanvasInteraction as use... }`) would hide a subscriber from a search for the
  // call. Hooks and WorkspaceCanvasInner never import it.
  it('only the draft overlay and the canvas menus import useCanvasInteraction, under any name', () => {
    const importers = trackedSourceFiles().filter(file =>
      namesImportedFromStoreContext(readFileSync(file, 'utf8')).includes('useCanvasInteraction'),
    )

    expect(importers.map(file => file.slice(CANVAS_DIR.length)).sort()).toEqual(
      [DRAFT_OVERLAY, CANVAS_MENUS].sort(),
    )
  })

  // One hook decides the render priority of every subscriber (arm B of #738). A file that reached
  // the store another way would render its part of a frame in another lane than the nodes.
  it('no file outside the store context reaches the canvas store to subscribe to it', () => {
    const reachers = trackedSourceFiles().filter(file =>
      /\bcreateCanvasStore\b|\bCanvasStoreReadApi\b|^import\s+\{[^}]*\}\s+from\s+'[^']*\/canvasStore'/m.test(
        readFileSync(file, 'utf8'),
      ),
    )

    expect(reachers.sort()).toEqual([`${STORE_DIR}canvasStore.ts`, STORE_CONTEXT].sort())
  })

  // By primitive: `useStore` is `useSyncExternalStore`, sync priority, a frame earlier than arm B
  // renders. It may serve the `ui` and `selection` slices and nothing else, so a generic slice hook
  // added to the context (and used by a third leaf) fails here. The one `subscribe` call is the
  // arm B hook's.
  it('the store context subscribes with useStore only to ui and selection, and with subscribe once', () => {
    const source = readFileSync(STORE_CONTEXT, 'utf8')

    expect(source.match(/\buseStore\s*\(/g)).toHaveLength(2)
    expect(source.match(/\buseStore\(api, state => selector\(state\.(\w+)\)\)/g)).toEqual([
      'useStore(api, state => selector(state.ui))',
      'useStore(api, state => selector(state.selection))',
    ])
    expect(source.match(/\.subscribe\s*\(/g)).toHaveLength(1)
    expect(source).not.toMatch(/\buseSyncExternalStore\s*\(/)
    expect(source.match(/export function useCanvasInteraction</g)).toHaveLength(1)
  })
})
