import { describe, expect, it } from 'vitest'
import { buildCoveContentSecurityPolicy } from '../../../electron.vite.config'

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

describe('buildCoveContentSecurityPolicy', () => {
  it("disables 'unsafe-inline' styles in production builds", () => {
    const productionPolicy = buildCoveContentSecurityPolicy(false)
    const styleDirective = getCspDirective(productionPolicy, 'style-src')

    expect(styleDirective).toBe("style-src 'self'")
    expect(styleDirective).not.toContain("'unsafe-inline'")
  })

  it("keeps 'unsafe-inline' styles in development builds for Vite", () => {
    const developmentPolicy = buildCoveContentSecurityPolicy(true)
    const styleDirective = getCspDirective(developmentPolicy, 'style-src')

    expect(styleDirective).toContain("'self'")
    expect(styleDirective).toContain("'unsafe-inline'")
  })
})
