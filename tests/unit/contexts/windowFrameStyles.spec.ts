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

describe('Tide completion and failure frames', () => {
  it('fades a constant screen-sized flash for 1s, with a 600ms static reduced-motion flash', () => {
    expect(declarations('.cove-window-flash')).toMatchObject({
      position: 'absolute',
      inset: '-1px',
      'pointer-events': 'none',
      'z-index': '4',
      opacity: '0',
      animation: 'cove-signal-complete 1s ease-out',
      'box-shadow':
        '0 0 0 calc(2px / var(--cove-canvas-zoom, 1)) var(--cove-signal-color), 0 0 calc(54px / var(--cove-canvas-zoom, 1)) calc(8px / var(--cove-canvas-zoom, 1)) color-mix(in srgb, var(--cove-signal-color) 55%, transparent)',
    })
    expect(frames('cove-signal-complete')).toEqual({
      '0%': { opacity: '1' },
      '100%': { opacity: '0' },
    })
    expect(declarations('.cove-window-flash', true).animation).toBe(
      'cove-signal-complete-static 0.6s steps(1, end)',
    )
    expect(frames('cove-signal-complete-static')).toEqual({
      '0%': { opacity: '0.9' },
      '100%': { opacity: '0' },
    })
  })
  it('uses all five scanline slices over 280ms without overriding React Flow transforms', () => {
    expect(declarations(".react-flow__node[data-cove-signal='fail']").animation).toBe(
      'cove-signal-fail 280ms steps(1, end)',
    )
    expect(frames('cove-signal-fail')).toEqual({
      '0%': { translate: '-5px 0', 'clip-path': 'inset(8% 0 58% 0)' },
      '20%': { translate: '4px 0', 'clip-path': 'inset(48% 0 22% 0)' },
      '40%': { translate: '-3px 0', 'clip-path': 'inset(0 0 72% 0)' },
      '60%': { translate: '3px 0', 'clip-path': 'inset(70% 0 4% 0)' },
      '80%': { translate: '-2px 0', 'clip-path': 'inset(30% 0 40% 0)' },
      '100%': { translate: 'none', 'clip-path': 'inset(0 0 0 0)' },
    })
    expect(declarations('.react-flow__node[data-cove-signal]', true).animation).toBe('none')
    expect(sheet.toString()).not.toMatch(/corner-spark|::after/)
  })
})

describe('Tide navigation focus', () => {
  it('draws four world-sized square corner brackets above the chrome', () => {
    const corners = declarations('.cove-window-focus-brackets')
    expect(corners).toMatchObject({
      inset: '-7px',
      'border-radius': '0',
      'pointer-events': 'none',
      'z-index': '4',
    })
    expect(corners.background.match(/10px 2px/g)).toHaveLength(4)
    expect(corners.background.match(/2px 10px/g)).toHaveLength(4)
    expect(corners.background).not.toContain('zoom')
    expect(corners.animation).toBeUndefined()
    expect(corners.background).toContain('var(--cove-navigation-accent)')
    sheet.walkRules(rule => {
      if (!rule.selector.includes('[data-cove-navigation-focus]:not(.selected)')) {
        return
      }
      const styles = Object.fromEntries(
        rule.nodes.flatMap(node =>
          node.type === 'decl' ? [[node.prop, node.value.replace(/\s+/g, ' ')]] : [],
        ),
      )
      expect(styles['border-color']).toBe('var(--cove-navigation-accent)')
      expect(styles['box-shadow']).toBe(
        '0 0 0 1.5px var(--cove-label-color, transparent), 0 0 0 1px var(--cove-navigation-accent), 0 0 26px 2px color-mix(in srgb, var(--cove-navigation-accent) 26%, transparent), var(--cove-node-shadow)',
      )
    })
  })
})
