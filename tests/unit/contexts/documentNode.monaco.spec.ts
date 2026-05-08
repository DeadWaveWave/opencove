import { describe, expect, it } from 'vitest'
import { resolveDocumentNodeMonacoThemeId } from '../../../src/contexts/workspace/presentation/renderer/components/DocumentNode.monacoTheme'

describe('DocumentNode Monaco', () => {
  it('maps light base theme to the light Monaco theme and everything else to dark', () => {
    expect(resolveDocumentNodeMonacoThemeId('light')).toBe('vs')
    expect(resolveDocumentNodeMonacoThemeId('dark')).toBe('vs-dark')
    expect(resolveDocumentNodeMonacoThemeId('system')).toBe('vs-dark')
    expect(resolveDocumentNodeMonacoThemeId(null)).toBe('vs-dark')
  })
})
