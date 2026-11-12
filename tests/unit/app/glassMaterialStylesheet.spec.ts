// @vitest-environment node

import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss, { type Rule } from 'postcss'
import { describe, expect, it } from 'vitest'

const STYLES = resolve(__dirname, '../../../src/app/renderer/styles')
// The frames node-chrome.css lays `--cove-node-background-image` on; the image window has no glass.
const GLASS_FRAMES = [
  'terminal-node',
  'cove-canvas-node-window',
  'task-node',
  'role-node',
  'note-node',
  'document-node',
  'folder-node',
  'website-node',
]

function rulesOf(file: string): Rule[] {
  const rules: Rule[] = []
  postcss.parse(readFileSync(resolve(STYLES, file), 'utf8')).walkRules(rule => {
    rules.push(rule)
  })
  return rules
}

function declarationsOf(rule: Rule): Record<string, string> {
  return Object.fromEntries(
    rule.nodes.flatMap(node => (node.type === 'decl' ? [[node.prop, node.value]] : [])),
  )
}

const compact = (value: string) => value.replace(/\s+/g, ' ').trim()

// Families with generated glass; Pixel has no glass to light.
const GENERATED_FAMILIES = ":root[data-cove-family='cove']"

describe('glass material', () => {
  it('rims every glass frame with the theme rim, a 1px ring just inside its border', () => {
    const rim = rulesOf('node-chrome.css').find(rule => rule.selector.includes('::before'))
    expect(rim, 'node-chrome.css draws the rim on ::before').toBeDefined()
    const selector = compact(rim!.selector)
    // Elsewhere the masked layer would draw nothing and still cost a compositing surface per window.
    expect(selector.startsWith(`${GENERATED_FAMILIES} `), selector).toBe(true)
    for (const frame of GLASS_FRAMES) {
      expect(selector, frame).toContain(`.${frame}`)
    }
    expect(selector).not.toContain('.image-node')
    const declarations = declarationsOf(rim!)
    // Frames clip at the padding box, so the ring sits inside the border, on the inner radius.
    expect(declarations).toMatchObject({
      content: "''",
      position: 'absolute',
      inset: '0',
      padding: '1px',
      'border-radius': 'var(--cove-node-inner-radius)',
      background: 'var(--cove-node-rim)',
      'pointer-events': 'none',
    })
    // Only the padding ring survives the mask: the content box is cut out of the border box.
    expect(compact(declarations['mask'] ?? '')).toBe(
      'linear-gradient(var(--cove-mask-opaque) 0 0) content-box exclude, linear-gradient(var(--cove-mask-opaque) 0 0)',
    )
  })

  it('positions every glass frame, so its rim follows the frame and not the canvas node', () => {
    const files = readdirSync(STYLES).filter(name => name.endsWith('.css'))
    const positioned = new Set<string>()
    for (const file of files) {
      for (const rule of rulesOf(file)) {
        if (declarationsOf(rule)['position'] === 'relative') {
          rule.selectors.forEach(part => positioned.add(part.trim()))
        }
      }
    }
    expect(GLASS_FRAMES.filter(frame => !positioned.has(`.${frame}`))).toEqual([])
  })

  it('lights the chrome over the wall with the theme sheen and grain above its glass tint', () => {
    const chrome = rulesOf('app-shell-wall.css').find(rule =>
      rule.selector.includes(':is(.app-header, .workspace-sidebar)'),
    )
    expect(chrome).toBeDefined()
    expect(compact(declarationsOf(chrome!)['background'] ?? '')).toBe(
      'var(--cove-chrome-background-image), var(--cove-surface)',
    )
  })

  it('leaves the chrome light and the grain off until a generated family and the startup draw', () => {
    const root = rulesOf('base.css').find(rule => rule.selector === ':root')
    expect(root).toBeDefined()
    expect(declarationsOf(root!)).toMatchObject({
      '--cove-node-background-image': 'none',
      '--cove-chrome-background-image': 'none',
      // bootstrap/installGlassGrain.ts sets these inline on the root, over these defaults.
      '--cove-glass-grain-dark': 'none',
      '--cove-glass-grain-light': 'none',
      // Frames clip at the padding box, inside their 1px border.
      '--cove-node-inner-radius': 'calc(var(--cove-node-radius) - 1px)',
    })
  })

  it('raises the label flag above the rim only where there is a rim', () => {
    const rim = rulesOf('node-chrome.css').find(rule => rule.selector.includes('::before'))
    const rimLayer = Number(declarationsOf(rim!)['z-index'])
    const flags = rulesOf('node-color-identity.css').filter(
      rule => rule.selector.includes('__header') && rule.selector.includes('::before'),
    )
    const raised = flags.filter(rule => declarationsOf(rule)['z-index'] !== undefined)
    expect(raised).toHaveLength(1)
    expect(compact(raised[0]!.selector).startsWith(`${GENERATED_FAMILIES} `)).toBe(true)
    expect(Number(declarationsOf(raised[0]!)['z-index'])).toBeGreaterThan(rimLayer)
  })

  it('tiles each acrylic grain at its own size, as window glass tiles the glass grain', () => {
    const acrylic = rulesOf('ui-surface.css').find(
      rule => rule.selector === ".cove-surface[data-material='acrylic']",
    )
    expect(acrylic).toBeDefined()
    // The default noise is a 160px SVG and generated families swap in the 180px glass grain: a
    // fixed tile size would stretch one of them.
    expect(compact(declarationsOf(acrylic!)['background'] ?? '')).toBe(
      'var(--cove-acrylic-grain), var(--cove-acrylic-surface)',
    )
  })
})
