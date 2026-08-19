const ALWAYS_ON_TERMINAL_EVENTS = new Set(['init', 'resize', 'hydrated'])
export const ISSUE_REPORT_BREADCRUMB_CAPACITY = 200

export function shouldRecordTerminalBreadcrumb(event: string): boolean {
  return ALWAYS_ON_TERMINAL_EVENTS.has(event) || event.startsWith('geometry-')
}
