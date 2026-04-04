import { describe, expect, it } from 'vitest'
import { isEditableDomTarget } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/domTargets'

describe('workspace canvas editable DOM targets', () => {
  it('treats the terminal focus scope as editable even when the click lands on a nested div', () => {
    const terminalBody = document.createElement('div')
    terminalBody.dataset.coveFocusScope = 'terminal'

    const nestedSurface = document.createElement('div')
    terminalBody.append(nestedSurface)

    expect(isEditableDomTarget(nestedSurface)).toBe(true)
  })

  it('keeps plain non-editable elements non-editable', () => {
    const plainDiv = document.createElement('div')
    expect(isEditableDomTarget(plainDiv)).toBe(false)
  })
})
