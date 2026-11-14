import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

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
})
