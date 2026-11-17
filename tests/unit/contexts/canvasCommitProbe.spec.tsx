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

function Probed({ input }: { input: number }) {
  const [state, set] = useState(0)
  setState = set
  useCanvasCommitProbe('Probed', { input })
  return <span>{state}</span>
}

describe('useCanvasCommitProbe', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      value: { meta: { isTest: true } },
    })
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
    expect(readCanvasCommitRecords().map(record => record.changed)).toEqual([
      ['input'],
      [],
      ['input'],
    ])

    resetWindowCommitCounts()
    expect(readCanvasCommitCounts()).toEqual({})
    expect(readCanvasCommitRecords()).toEqual([])
  })
})
