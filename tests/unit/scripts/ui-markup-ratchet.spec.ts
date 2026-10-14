import { describe, expect, it } from 'vitest'
import {
  compareMarkupRatchet,
  countMarkupLiterals,
  serializeMarkupRatchet,
} from '../../../scripts/lib/ui-markup-ratchet.mjs'

const file = (path: string, content: string) => ({ path, content })

describe('UI markup ratchet', () => {
  it('counts native title attributes on intrinsic elements per file', () => {
    const counts = countMarkupLiterals([
      file(
        'src/app/renderer/shell/Header.tsx',
        `export function Header({ name }: { name: string }) {
          return (
            <header>
              <button type="button" title="Open settings" />
              <span title={name}>{name}</span>
              <a href="#" title={\`Go to \${name}\`}>Go</a>
            </header>
          )
        }`,
      ),
    ])

    expect(counts).toEqual({ 'native-title': { 'src/app/renderer/shell/Header.tsx': 3 } })
  })

  it('ignores component props, iframe names, SVG title elements and spread props', () => {
    const counts = countMarkupLiterals([
      file(
        'src/app/renderer/shell/Panel.tsx',
        `export function Panel(props: { hint: string }) {
          return (
            <>
              <SettingsGroup title="Appearance" />
              <WindowHeading title="Terminal" />
              <iframe title="Plugin preview" src="about:blank" />
              <svg><title>Logo</title></svg>
              <button type="button" {...props} />
            </>
          )
        }`,
      ),
    ])

    expect(counts).toEqual({ 'native-title': {} })
  })

  it('fails increases, asks for a refreshed baseline after decreases and serializes sorted', () => {
    const baseline = { 'native-title': { 'b.tsx': 2, 'a.tsx': 1 } }
    expect(
      compareMarkupRatchet({ 'native-title': { 'a.tsx': 1, 'b.tsx': 3 } }, baseline),
    ).toMatchObject([{ file: 'b.tsx', rule: 'native-title', baseline: 2, current: 3 }])
    const [decrease] = compareMarkupRatchet(
      { 'native-title': { 'a.tsx': 1, 'b.tsx': 1 } },
      baseline,
    )
    expect(decrease?.message).toContain('pnpm ui:style-ratchet')
    expect(compareMarkupRatchet(baseline, baseline)).toEqual([])
    expect(serializeMarkupRatchet({ 'native-title': { 'b.tsx': 2, 'a.tsx': 1, 'c.tsx': 0 } })).toBe(
      `${JSON.stringify({ 'native-title': { 'a.tsx': 1, 'b.tsx': 2 } }, null, 2)}\n`,
    )
  })
})
