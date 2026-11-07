// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

const sheet = postcss.parse(
  readFileSync(resolve(__dirname, '../../../src/app/renderer/styles/window-signals.css'), 'utf8'),
)
function declarations(selector: string, reduced = false) {
  const result: Record<string, string> = {}
  sheet.walkRules(rule => {
    if (rule.selector.replace(/\s+/g, ' ') !== selector) {
      return
    }
    if ((rule.parent?.type === 'atrule' && rule.parent.name === 'media') !== reduced) {
      return
    }
    rule.walkDecls(decl => {
      result[decl.prop] = decl.value.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')')
    })
  })
  return result
}
function frames(name: string) {
  const result: Record<string, Record<string, string>> = {}
  sheet.walkAtRules('keyframes', rule => {
    if (rule.params !== name) {
      return
    }
    rule.walkRules(frame => {
      result[frame.selector.replace(/\s+/g, ' ')] = {}
      frame.walkDecls(decl => {
        result[frame.selector.replace(/\s+/g, ' ')][decl.prop] = decl.value
      })
    })
  })
  return result
}

describe('Tide waiting frames', () => {
  it('keeps the halo screen-sized, above the glass, and animates opacity only', () => {
    expect(declarations('.cove-window-halo')).toMatchObject({
      position: 'absolute',
      inset: '-1px',
      'border-radius': 'var(--cove-node-radius)',
      'pointer-events': 'none',
      'z-index': '4',
      opacity: '0.8',
      'box-shadow':
        '0 0 0 calc(1px / var(--cove-canvas-zoom, 1)) var(--cove-status-waiting, var(--cove-warning)), 0 0 calc(28px / var(--cove-canvas-zoom, 1)) calc(3px / var(--cove-canvas-zoom, 1)) color-mix(in srgb, var(--cove-status-waiting, var(--cove-warning)) 42%, transparent)',
    })
    expect(declarations("[data-cove-frame-signals='on'] .cove-window-halo").animation).toBe(
      'cove-waiting-halo 1.3s ease-in-out infinite',
    )
    expect(frames('cove-waiting-halo')).toEqual({
      '0%, 100%': { opacity: '0.3' },
      '50%': { opacity: '1' },
    })
    expect(declarations("[data-cove-frame-signals='on'] .cove-window-halo", true).animation).toBe(
      'none',
    )
  })
  it('tints the real chrome from authoritative status, independent of transient signals', () => {
    expect(
      declarations(
        ".workspace-canvas .react-flow__node[data-cove-window-status='waiting']:not(.selected) .terminal-node",
      )['border-color'],
    ).toBe(
      'color-mix(in srgb, var(--cove-status-waiting, var(--cove-warning)) 70%, var(--cove-node-border))',
    )
    expect(
      declarations(
        ".workspace-canvas .react-flow__node[data-cove-window-status='failed']:not(.selected) .terminal-node",
      )['border-color'],
    ).toBe('var(--cove-status-failed, var(--cove-danger))')
  })
})
