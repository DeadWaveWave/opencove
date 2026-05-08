/// <reference types="vite/client" />

import { OpenCoveApi } from '../preload/index'

declare global {
  interface Window {
    opencoveApi: OpenCoveApi
  }
}
