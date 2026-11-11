import { installDesktopOpenCoveApi } from './installDesktopOpenCoveApi'

/** Covers installer and chunk-load failures, which occur before React's ErrorBoundary. */
export async function startDesktop(
  install = installDesktopOpenCoveApi,
  load = () => import('./renderApp'),
): Promise<void> {
  try {
    install()
    if (window.opencoveApi?.meta?.isTest) {
      const { installDesktopAcceptanceHarness } = await import('./desktopAcceptanceHarness')
      installDesktopAcceptanceHarness()
    }
    const { renderApp } = await load()
    renderApp()
  } catch {
    const root = document.getElementById('root')
    if (!root) {
      return
    }
    const chinese = navigator.language.toLowerCase().startsWith('zh')
    root.setAttribute('role', 'alert')
    root.textContent = chinese
      ? 'OpenCove 无法启动。请重新加载窗口；如果问题仍然存在，请重启应用。'
      : 'OpenCove could not start. Reload this window. If the problem continues, restart the app.'
    const button = document.createElement('button')
    button.textContent = chinese ? '重新加载' : 'Reload window'
    button.addEventListener('click', () => window.location.reload())
    root.append(document.createElement('br'), button)
  }
}
