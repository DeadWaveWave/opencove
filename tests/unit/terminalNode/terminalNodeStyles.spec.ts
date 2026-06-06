import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const rendererStylesDir = join(process.cwd(), 'src', 'app', 'renderer', 'styles')

function readRendererStyle(fileName: string): string {
  return readFileSync(join(rendererStylesDir, fileName), 'utf8')
}

describe('terminal node styles', () => {
  it('reserves horizontal xterm padding so DOM glyph overhang is not clipped at the terminal edge', () => {
    const css = readRendererStyle('terminal-node.css')

    expect(css).toMatch(/\.terminal-node__terminal\s+\.xterm\s*{[^}]*\bpadding:\s*8px;\s*[^}]*}/s)
  })

  it('keeps DOM renderer row overflow visible despite xterm inline row clipping', () => {
    const css = readRendererStyle('terminal-node.webgl-layout.css')

    expect(css).toContain(
      ".terminal-node__terminal[data-cove-terminal-renderer='dom'] .xterm-rows > div",
    )
    expect(css).toMatch(/\boverflow:\s*visible\s*!important;/)
  })

  it('keeps DOM renderer xterm root overflow visible so glyph overhang is not clipped by the root', () => {
    const css = readRendererStyle('terminal-node.webgl-layout.css')

    expect(css).toMatch(/\.terminal-node__terminal\s+\.xterm\s*{[^}]*\boverflow:\s*hidden;/s)
    expect(css).toMatch(
      /\.terminal-node__terminal\[data-cove-terminal-renderer='dom'\]\s+\.xterm\s*{[^}]*\boverflow:\s*visible;/s,
    )
  })

  it('force hides the xterm overview ruler so resume decorations cannot draw a vertical line', () => {
    const css = readRendererStyle('terminal-node.css')

    expect(css).toMatch(
      /\.terminal-node__terminal\s+\.xterm-decoration-overview-ruler\s*{[^}]*\bdisplay:\s*none\s*!important;[^}]*\bwidth:\s*0\s*!important;[^}]*\bopacity:\s*0\s*!important;[^}]*\bpointer-events:\s*none\s*!important;[^}]*}/s,
    )
  })

  it('keeps terminal side resize hitboxes easy to grab', () => {
    const css = readRendererStyle('terminal-node.css')

    expect(css).toMatch(
      /\.terminal-node__resizer--left,\s*\.terminal-node__resizer--right\s*{[^}]*\bwidth:\s*10px;[^}]*}/s,
    )
  })
})
