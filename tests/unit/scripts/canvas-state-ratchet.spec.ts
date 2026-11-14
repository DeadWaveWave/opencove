import { describe, expect, it } from 'vitest'
import {
  CANVAS_AREA_PREFIX,
  WORKSPACE_RENDERER_PREFIX,
  compareCanvasStateRatchet,
  countCanvasState,
  serializeCanvasStateRatchet,
  blankNonCode,
} from '../../../scripts/lib/canvas-state-ratchet.mjs'

const HOOK = `${CANVAS_AREA_PREFIX}hooks/useThing.ts`
const OUTSIDE = 'src/app/renderer/shell/hooks/useShell.ts'
const file = (path: string, content: string) => ({ path, content })
const countIn = (content: string, path = HOOK) => countCanvasState([file(path, content)])
const only = (counts: Record<string, Record<string, number>>, rule: string, path = HOOK) =>
  counts[rule][path] ?? 0

describe('canvas state counters', () => {
  it('counts ref and setter types, with or without a React prefix', () => {
    const counts = countIn(`
      import type { MutableRefObject, RefObject, Dispatch, SetStateAction } from 'react'
      type A = { a: MutableRefObject<number>; b: RefObject<HTMLDivElement | null> }
      type B = { c: React.MutableRefObject<string>; d: React.RefObject<string> }
      type C = { e: Dispatch<SetStateAction<number>>; f: React.Dispatch<React.SetStateAction<number>> }
    `)
    expect(only(counts, 'ref-type')).toBe(4)
    expect(only(counts, 'setter-type')).toBe(2)
  })

  it('counts ref writes of every assignment operator but not reads or comparisons', () => {
    const counts = countIn(`
      nodesRef.current = nodes
      params.spacesRef.current ||= []
      ref.current ??= 0
      countRef.current += 1
      if (a.current === b) {}
      if (xRef.current == 1) {}
      const read = xRef.current
      const cb = () => yRef.current
      fn(xRef.current >= 2, xRef.current <= 2)
      other.current = 1
    `)
    expect(only(counts, 'ref-write')).toBe(4)
  })

  it('counts legacy channel identifiers as whole words only', () => {
    const counts = countIn(`
      const { nodesRef, spacesRef, setNodes, onSpacesChange, onRequestPersistFlush } = p
      selectedNodesRef.current
      setNodesSnapshot(nodeStore.setNodes)
      onSpacesChanged()
    `)
    expect(only(counts, 'legacy-channel')).toBe(6)
  })

  it('counts workspace writers repo-wide, including across line breaks', () => {
    const counts = countIn(
      `
      const { setWorkspaces } = useAppStore.getState()
      useAppStore
        .setState({ a: 1 })
      useAppStore.getState().setWorkspaces(x)
    `,
      OUTSIDE,
    )
    expect(only(counts, 'workspace-writer', OUTSIDE)).toBe(3)
  })

  it('scopes ref and setter rules to the workspace renderer, and the others to src', () => {
    const source =
      'const r: RefObject<number> = x; const s: Dispatch<SetStateAction<number>> = y; a.current = 1; setNodes(y); setWorkspaces(z)'
    const moved = `${WORKSPACE_RENDERER_PREFIX}hooks/useMoved.ts`
    const inMoved = countIn(source, moved)
    expect(only(inMoved, 'ref-type', moved)).toBe(1)
    expect(only(inMoved, 'setter-type', moved)).toBe(1)
    expect(only(inMoved, 'legacy-channel', moved)).toBe(1)
    expect(only(inMoved, 'workspace-writer', moved)).toBe(1)

    const shell = 'src/app/renderer/shell/hooks/useShell.ts'
    const inShell = countIn(source, shell)
    expect(only(inShell, 'ref-type', shell)).toBe(0)
    expect(only(inShell, 'setter-type', shell)).toBe(0)
    expect(only(inShell, 'ref-write', shell)).toBe(0)
    expect(only(inShell, 'legacy-channel', shell)).toBe(1)
    expect(only(inShell, 'workspace-writer', shell)).toBe(1)

    const outside = 'scripts/helper.ts'
    expect(countIn(source, outside)['legacy-channel']).toEqual({})
  })

  it('counts the same occurrences after a file moves within the counted scope', () => {
    const source = 'nodesRef.current = x; const r: RefObject<number> = y; setNodes(z)'
    const before = countIn(source, `${CANVAS_AREA_PREFIX}hooks/useNodesStore.ts`)
    const after = countIn(source, `${WORKSPACE_RENDERER_PREFIX}hooks/useNodesStore.ts`)
    for (const rule of Object.keys(before)) {
      expect(Object.values(after[rule])).toEqual(Object.values(before[rule]))
    }
  })

  it('excludes test files, declaration files and files outside src', () => {
    const source = 'setNodes(a); setWorkspaces(b)'
    const counts = countCanvasState([
      file(`${CANVAS_AREA_PREFIX}hooks/useThing.spec.tsx`, source),
      file(`${CANVAS_AREA_PREFIX}hooks/useThing.test.ts`, source),
      file(`${CANVAS_AREA_PREFIX}hooks/__tests__/helper.ts`, source),
      file(`${CANVAS_AREA_PREFIX}hooks/types.d.ts`, source),
      file('tests/unit/contexts/helper.ts', source),
    ])
    expect(counts['legacy-channel']).toEqual({})
    expect(counts['workspace-writer']).toEqual({})
  })

  it('ignores comments, strings and template text but keeps template expressions', () => {
    const counts = countIn(`
      // setNodes(a)
      /* nodesRef.current = x
         setWorkspaces() */
      const a = 'call setNodes now'
      const b = "spacesRef.current = 1"
      const c = \`setNodes \${count} onSpacesChange\`
      const d = \`\${setNodes(1)} text \${nested({ k: spacesRef })}\`
      const e = 'it\\'s setNodes'
      real(setNodes)
    `)
    expect(only(counts, 'legacy-channel')).toBe(3)
    expect(only(counts, 'ref-write')).toBe(0)
  })

  it('counts a legacy channel name that is a whole quoted string, such as in type picks', () => {
    const counts = countIn(`
      type A = Pick<Ctx, 'spacesRef' | 'setNodes'>
      type B = Parameters<typeof useX>[0]['nodesRef']
      type C = Omit<Ctx, "onSpacesChange">
      const label = 'the setNodes handler'
      const other = 'spacesRefs'
    `)
    expect(only(counts, 'legacy-channel')).toBe(4)
  })

  it('does not let a backtick in a regex literal hide the lines after it', () => {
    const counts = countIn(
      [
        'const pattern = /`[a-z]+/g',
        'const a = useRef(0)',
        'spacesRef.current = 1',
        'const b: RefObject<number> = x',
        'const c = `template ${setNodes(1)} text setNodes`',
        'setNodes(2)',
      ].join('\n'),
    )
    expect(only(counts, 'ref-write')).toBe(1)
    expect(only(counts, 'ref-type')).toBe(1)
    expect(only(counts, 'legacy-channel')).toBe(3)
  })

  it('does not let a backtick in JSX text hide the lines after it', () => {
    const path = `${WORKSPACE_RENDERER_PREFIX}components/Panel.tsx`
    const counts = countIn(
      [
        'export function Panel() {',
        '  const ref = useRef<HTMLDivElement>(null)',
        '  ref.current = null',
        "  return <p>use `setNodes` and don't panic</p>",
        '}',
        'const x: RefObject<number> = y',
        'setNodes(1)',
      ].join('\n'),
      path,
    )
    expect(only(counts, 'ref-write', path)).toBe(1)
    expect(only(counts, 'ref-type', path)).toBe(1)
    expect(only(counts, 'legacy-channel', path)).toBe(1)
  })

  it('reads a slash as a division or a regex by position, not as a comment', () => {
    const counts = countIn(
      String.raw`const a = b / c; const r = /\/\//g; setNodes(1) // setNodes(2)`,
    )
    expect(only(counts, 'legacy-channel')).toBe(1)
  })

  it('does not move a count when formatting changes', () => {
    const compact = `a.current=1;type T=Dispatch<SetStateAction<number>>;const x:RefObject<number>=y;setNodes(1)`
    const spread = `
      a
        .current
        =
        1
      type T = Dispatch <
        React.SetStateAction<number>
      >
      const x: RefObject
        <number> = y
      /* note */ setNodes   (1)
    `
    const rename = compact.replace('a.current', 'aRef.current')
    expect(countIn(compact)).toEqual(countIn(compact.replace(/;/g, '\n')))
    expect(only(countIn(spread), 'setter-type')).toBe(1)
    expect(only(countIn(spread), 'ref-type')).toBe(1)
    expect(only(countIn(spread), 'legacy-channel')).toBe(1)
    expect(only(countIn(rename), 'ref-write')).toBe(1)
  })

  it('keeps line breaks when stripping so that the text keeps its shape', () => {
    const source = 'a // x\n/* y\nz */ `b\nc ${d}\ne`'
    const blanked = blankNonCode(source)
    expect(blanked).not.toContain('//')
    expect(blanked).toMatch(/\sd\s/)
    expect(blanked.split('\n')).toHaveLength(source.split('\n').length)
  })
})

describe('canvas state ratchet', () => {
  const baseline = {
    'ref-type': { 'src/a.ts': 3 },
    'setter-type': {},
    'ref-write': {},
    'legacy-channel': {},
    'workspace-writer': {},
  }
  const withRefType = (byFile: Record<string, number>) => ({
    ...baseline,
    'ref-type': byFile,
  })

  it('accepts equal counts', () => {
    expect(compareCanvasStateRatchet(withRefType({ 'src/a.ts': 3 }), baseline)).toEqual([])
  })

  it('fails when a count rises, and when a file appears', () => {
    const issues = compareCanvasStateRatchet(
      withRefType({ 'src/a.ts': 4, 'src/b.ts': 1 }),
      baseline,
    )
    expect(issues.map(issue => [issue.file, issue.baseline, issue.current])).toEqual([
      ['src/a.ts', 3, 4],
      ['src/b.ts', 0, 1],
    ])
    expect(issues[0].message).toContain('more than the baseline')
  })

  it('fails when a count drops until the baseline is regenerated', () => {
    const issues = compareCanvasStateRatchet(withRefType({ 'src/a.ts': 2 }), baseline)
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toContain('pnpm canvas:state-ratchet')
    expect(compareCanvasStateRatchet(withRefType({}), baseline)).toHaveLength(1)
  })

  it('serializes sorted, without zero counts', () => {
    const text = serializeCanvasStateRatchet(
      withRefType({ 'src/b.ts': 1, 'src/a.ts': 2, 'src/z.ts': 0 }),
    )
    expect(Object.keys(JSON.parse(text))).toEqual([
      'legacy-channel',
      'ref-type',
      'ref-write',
      'setter-type',
      'workspace-writer',
    ])
    expect(JSON.parse(text)['ref-type']).toEqual({ 'src/a.ts': 2, 'src/b.ts': 1 })
  })
})
