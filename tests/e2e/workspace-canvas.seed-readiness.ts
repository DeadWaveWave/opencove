// Passed directly to Playwright evaluate, so keep this function self-contained.
export function isSeededWorkspaceNavigationReady(expectedWorkspaceCount: number): boolean {
  const shell = document.querySelector('.app-shell')
  if (!shell || document.querySelector('.app-startup-state')) {
    return false
  }
  if (shell.classList.contains('app-shell--mobile-navigation')) {
    const trigger = shell.querySelector<HTMLButtonElement>('[data-testid="primary-sidebar-open"]')
    if (!trigger || trigger.disabled || trigger.closest('[inert], [hidden]')) {
      return false
    }
    const style = getComputedStyle(trigger)
    return style.display !== 'none' && style.visibility !== 'hidden'
  }
  return shell.querySelectorAll('.workspace-item').length >= expectedWorkspaceCount
}
