import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const CANVAS_DIR = 'src/contexts/workspace/presentation/renderer/components/workspaceCanvas/'
const CANVAS_STATE_HOOK = 'hooks/useCanvasState.ts'
const SPACE_OVERLAY = 'view/WorkspaceSpaceRegionsOverlay.tsx'
const ALLOWED = new Set([CANVAS_STATE_HOOK, SPACE_OVERLAY])
const REMOVED_NAMES = [
  'selectedSpaceIdsRef',
  'dragSelectedSpaceIdsRef',
  'setSelectedSpaceIds',
  'setSortedSelectedSpaceIds',
  'selectedNodeIdsRef',
  'setSelectedNodeIds',
]
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
  it('useCanvasSelection is called only by useCanvasState and the Space overlay', () => {
    const files = execFileSync('git', ['ls-files', CANVAS_DIR], { encoding: 'utf8' })
      .split('\n')
      .filter(file => /\.tsx?$/.test(file) && !/\.spec\./.test(file))
    expect(files.length).toBeGreaterThan(100)

    const callers = files.filter(file => /\buseCanvasSelection\(/.test(readFileSync(file, 'utf8')))

    expect(
      callers.map(file => file.slice(CANVAS_DIR.length)).filter(file => !ALLOWED.has(file)),
    ).toEqual([])
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
