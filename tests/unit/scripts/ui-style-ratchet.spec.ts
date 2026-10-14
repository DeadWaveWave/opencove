import { describe, expect, it } from 'vitest'
import {
  compareScaleRatchet,
  countScaleLiterals,
  serializeScaleRatchet,
} from '../../../scripts/lib/ui-style-ratchet.mjs'

const file = (path: string, content: string) => ({ path, content })

describe('UI scale ratchet', () => {
  it('counts hard-coded scale values per rule and file', () => {
    const counts = countScaleLiterals([
      file(
        'src/app/renderer/styles/card.css',
        `
        .card {
          font-size: calc(12px * var(--cove-ui-font-scale));
          border-radius: 8px;
          border-top-left-radius: 4px;
          z-index: 140;
          padding: 8px 12px;
          margin-inline: -6px;
          row-gap: 10px;
        }
        .title { font-size: 0.9em; }
        `,
      ),
    ])

    expect(counts).toEqual({
      'font-size': { 'src/app/renderer/styles/card.css': 2 },
      radius: { 'src/app/renderer/styles/card.css': 2 },
      spacing: { 'src/app/renderer/styles/card.css': 3 },
      'z-index': { 'src/app/renderer/styles/card.css': 1 },
    })
  })

  it('ignores tokens, zeros, local stacking, sub-grid nudges, comments and custom properties', () => {
    const counts = countScaleLiterals([
      file(
        'src/app/renderer/styles/card.css',
        `
        /* font-size: 14px; z-index: 900; padding: 16px; */
        :root { --cove-control-gap: 6px; --cove-radius-sm: 8px; }
        .card:hover {
          font-size: var(--cove-font-size-body);
          border-radius: var(--cove-radius-sm);
          border-radius: 50%;
          z-index: 2;
          z-index: var(--cove-z-popover);
          padding: 0;
          margin: 0 auto;
          gap: var(--cove-spacing-2);
          padding-top: 2px;
        }
        `,
      ),
    ])

    expect(counts).toEqual({ 'font-size': {}, radius: {}, spacing: {}, 'z-index': {} })
  })

  it('reports growth, unlocked improvements and stale baseline entries', () => {
    const issues = compareScaleRatchet(
      {
        'font-size': { 'a.css': 3 },
        radius: { 'b.css': 1 },
        spacing: { 'a.css': 5 },
        'z-index': {},
      },
      {
        'font-size': { 'a.css': 2 },
        radius: { 'b.css': 4 },
        spacing: { 'a.css': 5 },
        'z-index': { 'removed.css': 1 },
      },
    )

    expect(issues).toEqual([
      expect.objectContaining({ file: 'a.css', rule: 'font-size', baseline: 2, current: 3 }),
      expect.objectContaining({ file: 'b.css', rule: 'radius', baseline: 4, current: 1 }),
      expect.objectContaining({ file: 'removed.css', rule: 'z-index', baseline: 1, current: 0 }),
    ])
    expect(issues[0].message).toContain('--cove-font-size-*')
    expect(issues[1].message).toContain('pnpm ui:style-ratchet')
  })

  it('accepts counts that match the baseline', () => {
    const counts = { 'font-size': { 'a.css': 1 }, radius: {}, spacing: {}, 'z-index': {} }
    expect(compareScaleRatchet(counts, JSON.parse(serializeScaleRatchet(counts)))).toEqual([])
  })

  it('serializes a stable rule-major baseline', () => {
    const text = serializeScaleRatchet({
      spacing: { 'b.css': 2, 'a.css': 1 },
      'font-size': { 'c.css': 4 },
      'z-index': {},
      radius: {},
    })

    expect(text).toBe(
      [
        '{',
        '  "font-size": {',
        '    "c.css": 4',
        '  },',
        '  "radius": {},',
        '  "spacing": {',
        '    "a.css": 1,',
        '    "b.css": 2',
        '  },',
        '  "z-index": {}',
        '}',
        '',
      ].join('\n'),
    )
  })
})
