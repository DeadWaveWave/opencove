import { describe, expect, it } from 'vitest'
import {
  CANVAS_AREA_PREFIX,
  CANVAS_INNER_FILE,
  compareCanvasStateRatchet,
  countCanvasState,
  planCanvasStateUpdate,
  serializeCanvasStateRatchet,
  stripCommentsAndStrings,
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

  it('counts canvas-area rules only in the canvas area, and workspace writers everywhere', () => {
    const source = 'const r: RefObject<number> = x; setNodes(y); setWorkspaces(z)'
    const outside = countIn(source, OUTSIDE)
    expect(only(outside, 'ref-type', OUTSIDE)).toBe(0)
    expect(only(outside, 'legacy-channel', OUTSIDE)).toBe(0)
    expect(only(outside, 'workspace-writer', OUTSIDE)).toBe(1)

    const inner = countIn(source, CANVAS_INNER_FILE)
    expect(only(inner, 'ref-type', CANVAS_INNER_FILE)).toBe(1)
    expect(only(inner, 'legacy-channel', CANVAS_INNER_FILE)).toBe(1)
    expect(only(inner, 'workspace-writer', CANVAS_INNER_FILE)).toBe(1)
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
      const a = 'setNodes'
      const b = "spacesRef.current = 1"
      const c = \`setNodes \${count} onSpacesChange\`
      const d = \`\${setNodes(1)} text \${nested({ k: spacesRef })}\`
      const e = 'it\\'s setNodes'
      real(setNodes)
    `)
    expect(only(counts, 'legacy-channel')).toBe(3)
    expect(only(counts, 'ref-write')).toBe(0)
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
    const source = "a // x\n/* y\nz */ 'b\n'"
    expect(stripCommentsAndStrings(source).split('\n')).toHaveLength(source.split('\n').length)
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

  it('refuses to write a baseline whose total would rise, even when another file shrinks', () => {
    const plan = planCanvasStateUpdate({
      counts: withRefType({ 'src/a.ts': 2, 'src/b.ts': 2 }),
      baseline,
    })
    expect(plan).toEqual({
      ok: false,
      refusals: [{ rule: 'ref-type', before: 3, after: 4 }],
      serialized: null,
    })
  })

  it('writes a lower or equal total, including a count moved between files', () => {
    const lower = planCanvasStateUpdate({ counts: withRefType({ 'src/a.ts': 1 }), baseline })
    expect(lower.ok).toBe(true)
    expect(JSON.parse(lower.serialized!)['ref-type']).toEqual({ 'src/a.ts': 1 })

    const moved = planCanvasStateUpdate({ counts: withRefType({ 'src/c.ts': 3 }), baseline })
    expect(moved.ok).toBe(true)
  })

  it('treats a rule missing from an existing baseline as zero, and allows a first baseline', () => {
    const partial = { 'ref-type': { 'src/a.ts': 3 } }
    const plan = planCanvasStateUpdate({
      counts: { ...baseline, 'setter-type': { 'src/a.ts': 1 } },
      baseline: partial,
    })
    expect(plan.ok).toBe(false)
    expect(
      planCanvasStateUpdate({ counts: withRefType({ 'src/a.ts': 9 }), baseline: null }).ok,
    ).toBe(true)
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
