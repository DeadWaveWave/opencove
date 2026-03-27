import { describe, expect, it } from 'vitest'
import { buildOpenCoveContentSecurityPolicy } from '../../../electron.vite.config'

function getCspDirective(csp: string, directive: string): string | null {
  const prefix = `${directive} `
  for (const entry of csp.split(';')) {
    const trimmed = entry.trim()
    if (trimmed === directive || trimmed.startsWith(prefix)) {
      return trimmed
    }
  }
  return null
}

describe('buildOpenCoveContentSecurityPolicy', () => {
  it('keeps production `style-src` strict while allowing the xterm inline channels it requires', () => {
    const productionPolicy = buildOpenCoveContentSecurityPolicy(false)
    const styleDirective = getCspDirective(productionPolicy, 'style-src')
    const styleAttrDirective = getCspDirective(productionPolicy, 'style-src-attr')
    const styleElemDirective = getCspDirective(productionPolicy, 'style-src-elem')

    expect(styleDirective).toBe("style-src 'self'")
    expect(styleDirective).not.toContain("'unsafe-inline'")
    expect(styleAttrDirective).toBe("style-src-attr 'unsafe-inline'")
    expect(styleElemDirective).toBe("style-src-elem 'self' 'unsafe-inline'")
  })

  it("keeps 'unsafe-inline' styles in development builds for Vite", () => {
    const developmentPolicy = buildOpenCoveContentSecurityPolicy(true)
    const styleDirective = getCspDirective(developmentPolicy, 'style-src')
    const styleAttrDirective = getCspDirective(developmentPolicy, 'style-src-attr')
    const styleElemDirective = getCspDirective(developmentPolicy, 'style-src-elem')

    expect(styleDirective).toContain("'self'")
    expect(styleDirective).toContain("'unsafe-inline'")
    expect(styleAttrDirective).toBeNull()
    expect(styleElemDirective).toBeNull()
  })
})
