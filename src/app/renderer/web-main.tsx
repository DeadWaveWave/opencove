import { installBrowserOpenCoveApi } from './browser/browserOpenCoveApi'
import { ensureRandomUuid } from './bootstrap/ensureRandomUuid'
import { renderApp } from './bootstrap/renderApp'

ensureRandomUuid()
installBrowserOpenCoveApi()
renderApp()
