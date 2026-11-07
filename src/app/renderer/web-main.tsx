import { installBrowserOpenCoveApi } from './browser/browserOpenCoveApi'
import { ensureRandomUuid } from './bootstrap/ensureRandomUuid'
import { installGlassGrain } from './bootstrap/installGlassGrain'
import { renderApp } from './bootstrap/renderApp'

ensureRandomUuid()
installGlassGrain()
installBrowserOpenCoveApi()
renderApp()
