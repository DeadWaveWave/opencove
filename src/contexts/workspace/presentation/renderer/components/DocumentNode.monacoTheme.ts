export const DOCUMENT_NODE_MONACO_LIGHT_THEME = 'vs'
export const DOCUMENT_NODE_MONACO_DARK_THEME = 'vs-dark'

export function resolveDocumentNodeMonacoThemeId(baseScheme: string | null | undefined): string {
  return baseScheme === 'light' ? DOCUMENT_NODE_MONACO_LIGHT_THEME : DOCUMENT_NODE_MONACO_DARK_THEME
}
