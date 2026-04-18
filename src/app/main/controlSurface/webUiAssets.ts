import { existsSync, readFileSync } from 'node:fs'
import { extname, resolve } from 'node:path'

function resolveDevRendererOrigin(): string | null {
  const raw = process.env['ELECTRON_RENDERER_URL']?.trim()
  if (!raw) {
    return null
  }

  try {
    return new URL(raw).origin
  } catch {
    return null
  }
}

function resolveRendererAssetRoot(): string {
  const candidates = [
    resolve(__dirname, '../renderer'),
    resolve(__dirname, '../../renderer'),
    resolve(process.cwd(), 'out', 'renderer'),
  ]

  const matched = candidates.find(candidate => existsSync(resolve(candidate, 'web.html')))
  return matched ?? candidates[0]
}

function resolveContentType(filePath: string): string {
  const extension = extname(filePath).toLowerCase()
  if (extension === '.html') {
    return 'text/html; charset=utf-8'
  }
  if (extension === '.js' || extension === '.mjs') {
    return 'text/javascript; charset=utf-8'
  }
  if (extension === '.css') {
    return 'text/css; charset=utf-8'
  }
  if (extension === '.json') {
    return 'application/json; charset=utf-8'
  }
  if (extension === '.svg') {
    return 'image/svg+xml'
  }
  if (extension === '.png') {
    return 'image/png'
  }
  if (extension === '.jpg' || extension === '.jpeg') {
    return 'image/jpeg'
  }
  if (extension === '.webp') {
    return 'image/webp'
  }
  if (extension === '.woff2') {
    return 'font/woff2'
  }
  return 'application/octet-stream'
}

function renderDevWebUiHtml(devOrigin: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenCove Web</title>
    <link rel="icon" href="data:," />
    <script type="module">
      import RefreshRuntime from '${devOrigin}/@react-refresh'
      RefreshRuntime.injectIntoGlobalHook(window)
      window.$RefreshReg$ = () => {}
      window.$RefreshSig$ = () => type => type
      window.__vite_plugin_react_preamble_installed__ = true
    </script>
    <script type="module" src="${devOrigin}/@vite/client"></script>
    <script type="module" src="${devOrigin}/web-main.tsx"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`
}

export function tryResolveWebUiResponse(
  pathname: string,
  options: { allowDevOrigin?: boolean } = {},
): {
  statusCode: number
  contentType: string
  body: string | Buffer
} | null {
  const allowDevOrigin = options.allowDevOrigin !== false
  const devOrigin = allowDevOrigin ? resolveDevRendererOrigin() : null
  if (devOrigin) {
    if (pathname === '/' || pathname === '/web.html') {
      return {
        statusCode: 200,
        contentType: 'text/html; charset=utf-8',
        body: renderDevWebUiHtml(devOrigin),
      }
    }

    return null
  }

  const root = resolveRendererAssetRoot()
  const targetPath =
    pathname === '/' || pathname === '/web.html'
      ? resolve(root, 'web.html')
      : resolve(root, `.${pathname}`)

  if (!targetPath.startsWith(root)) {
    return null
  }

  if (!existsSync(targetPath)) {
    if (pathname === '/' || pathname === '/web.html') {
      return {
        statusCode: 503,
        contentType: 'text/plain; charset=utf-8',
        body: 'OpenCove Web bundle not found. Build the renderer bundle first.',
      }
    }
    return null
  }

  return {
    statusCode: 200,
    contentType: resolveContentType(targetPath),
    body: readFileSync(targetPath),
  }
}
