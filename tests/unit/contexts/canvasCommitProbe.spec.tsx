import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import React, { useState } from 'react'
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  readCanvasCommitCounts,
  readCanvasCommitRecords,
  resetWindowCommitCounts,
  useCanvasCommitProbe,
} from '../../../src/contexts/workspace/presentation/renderer/components/shared/windowCommitProbe'

let setState: (value: number) => void = () => undefined

function Probed({ input, other = 0 }: { input: number; other?: number }) {
  const [state, set] = useState(0)
  setState = set
  useCanvasCommitProbe('Probed', { input, other })
  return <span>{state}</span>
}

function CountOnly() {
  const [state, set] = useState(0)
  setState = set
  useCanvasCommitProbe('CountOnly')
  return <span>{state}</span>
}

function PropsProbed(props: { first: number; second: number }) {
  useCanvasCommitProbe('PropsProbed', props)
  return <span>{props.first}</span>
}

function setTestFlag(isTest: boolean) {
  Object.defineProperty(window, 'opencoveApi', {
    configurable: true,
    value: { meta: { isTest } },
  })
}

describe('useCanvasCommitProbe', () => {
  beforeEach(() => {
    setTestFlag(true)
    resetWindowCommitCounts()
  })
  afterEach(() => {
    Reflect.deleteProperty(window, 'opencoveApi')
    resetWindowCommitCounts()
  })

  it('counts commits, not render attempts', () => {
    const view = render(<Probed input={1} />)
    expect(readCanvasCommitCounts().Probed).toBe(1)

    act(() => setState(1))
    expect(readCanvasCommitCounts().Probed).toBe(2)

    act(() => setState(1))
    act(() => setState(1))
    expect(readCanvasCommitCounts().Probed).toBe(2)

    view.rerender(<Probed input={2} />)
    expect(readCanvasCommitCounts().Probed).toBe(3)
  })

  it('records which inputs changed, and none for a commit from internal state', () => {
    const view = render(<Probed input={1} />)
    act(() => setState(1))
    view.rerender(<Probed input={2} />)
    view.rerender(<Probed input={3} other={4} />)

    expect(readCanvasCommitRecords().map(record => [record.component, record.changed])).toEqual([
      ['Probed', ['input', 'other']],
      ['Probed', []],
      ['Probed', ['input']],
      ['Probed', ['input', 'other']],
    ])
  })

  it('records the changed props of a props object', () => {
    const view = render(<PropsProbed first={1} second={1} />)
    view.rerender(<PropsProbed first={1} second={2} />)

    expect(readCanvasCommitRecords().map(record => record.changed)).toEqual([
      ['first', 'second'],
      ['second'],
    ])
  })

  it('counts without records when no inputs are given', () => {
    render(<CountOnly />)
    act(() => setState(1))

    expect(readCanvasCommitCounts().CountOnly).toBe(2)
    expect(readCanvasCommitRecords()).toEqual([])
  })

  it('keeps only the newest 500 records', () => {
    const view = render(<PropsProbed first={0} second={0} />)
    for (let index = 1; index <= 510; index += 1) {
      view.rerender(<PropsProbed first={index} second={0} />)
    }

    expect(readCanvasCommitCounts().PropsProbed).toBe(511)
    expect(readCanvasCommitRecords()).toHaveLength(500)
  })

  it('clears counts and records on reset', () => {
    render(<Probed input={1} />)
    act(() => setState(1))
    expect(readCanvasCommitRecords()).toHaveLength(2)

    resetWindowCommitCounts()
    expect(readCanvasCommitCounts()).toEqual({})
    expect(readCanvasCommitRecords()).toEqual([])
  })

  it('records nothing when the window is not a test window', () => {
    setTestFlag(false)
    const view = render(<Probed input={1} />)
    act(() => setState(1))
    view.rerender(<Probed input={2} />)

    expect(readCanvasCommitCounts()).toEqual({})
    expect(readCanvasCommitRecords()).toEqual([])
  })

  it('records nothing when there is no preload API', () => {
    Reflect.deleteProperty(window, 'opencoveApi')
    render(<Probed input={1} />)

    expect(readCanvasCommitCounts()).toEqual({})
    expect(readCanvasCommitRecords()).toEqual([])
  })

  it('passes WorkspaceCanvasInner its own props object, so production allocates nothing', () => {
    const source = readFileSync(
      resolve(
        __dirname,
        '../../../src/contexts/workspace/presentation/renderer/components/WorkspaceCanvasInner.tsx',
      ),
      'utf8',
    )
    expect(source).toContain(
      'export function WorkspaceCanvasInner(props: WorkspaceCanvasInnerProps)',
    )
    expect(source.match(/useCanvasCommitProbe\(/g)).toHaveLength(1)
    expect(source).toContain("useCanvasCommitProbe('WorkspaceCanvasInner', props)")
  })
})
