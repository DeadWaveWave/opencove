/// <reference types="vite/client" />

import { OpenCoveApi } from '../preload/api'

declare global {
  interface Window {
    __opencoveBridge: import('@shared/contracts/rendererBridge').OpenCoveBridgeApi<OpenCoveApi>
    opencoveApi: OpenCoveApi
  }
}
