import './bootstrap/desktopApiInstallation'
import {
  desktopApiInstallationFailed,
  renderDesktopStartupFailure,
} from './bootstrap/desktopApiInstallation'
import { ensureRandomUuid } from './bootstrap/ensureRandomUuid'
import { installGlassGrain } from './bootstrap/installGlassGrain'
import { renderApp } from './bootstrap/renderApp'

if (desktopApiInstallationFailed) {
  renderDesktopStartupFailure()
} else {
  ensureRandomUuid()
  installGlassGrain()
  renderApp()
  if (window.opencoveApi.meta.isTest) {
    // Acceptance observations are optional and cannot delay or replace the first render.
    void import('./bootstrap/desktopAcceptanceHarness')
      .then(({ installDesktopAcceptanceHarness }) => installDesktopAcceptanceHarness())
      .catch(() => undefined)
  }
}
