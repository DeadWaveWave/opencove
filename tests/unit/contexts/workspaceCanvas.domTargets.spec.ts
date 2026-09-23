import { describe, expect, it } from 'vitest'
import {
  isEditableDomTarget,
  shouldFocusCanvasForPointerTarget,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/domTargets'

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

  it('leaves every file-browser target, including SVG icons, to its window focus owner', () => {
    const browser = document.createElement('div')
    browser.dataset.coveFocusScope = 'file-browser'
    browser.innerHTML = '<button><svg><path /></svg></button><div>Files</div>'
    for (const target of [browser, ...browser.querySelectorAll('*')]) {
      expect(shouldFocusCanvasForPointerTarget(target)).toBe(false)
    }
  })

  it('still focuses the canvas for ordinary canvas chrome but never editable input', () => {
    expect(shouldFocusCanvasForPointerTarget(document.createElement('div'))).toBe(true)
    expect(shouldFocusCanvasForPointerTarget(document.createElement('button'))).toBe(true)
    expect(shouldFocusCanvasForPointerTarget(document.createElement('input'))).toBe(false)
  })
})
