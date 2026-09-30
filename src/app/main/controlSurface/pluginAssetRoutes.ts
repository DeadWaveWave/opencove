import type { IncomingMessage, ServerResponse } from 'node:http'
import type { PluginInstallationManager } from '../../../contexts/plugins/application/PluginInstallationManager'
import { PLUGIN_BRIDGE_SCRIPT } from '../../../contexts/plugins/infrastructure/pluginBridgeScript'

export async function tryHandlePluginAssetRoute(input: {
  req: IncomingMessage
  res: ServerResponse
  url: URL
  plugins: PluginInstallationManager
}): Promise<boolean> {
  if (
    !input.url.pathname.startsWith('/plugin-assets/') &&
    !input.req.url?.startsWith('/plugin-assets/')
  ) {
    return false
  }
  const { req, res, url, plugins } = input
  const [, , token, ...parts] = url.pathname.split('/')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('referrer-policy', 'no-referrer')
  res.setHeader('x-content-type-options', 'nosniff')
  if (!url.pathname.startsWith('/plugin-assets/') || !token || !plugins.hasResourceToken(token)) {
    res.statusCode = 404
    res.end()
    return true
  }
  try {
    const path = parts.map(decodeURIComponent).join('/')
    if (path === '__close' && req.method === 'POST') {
      await plugins.closeViewToken(token)
      res.statusCode = 204
      res.end()
      return true
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 404
      res.end()
      return true
    }
    if (!path) {
      res.statusCode = 404
      res.end()
      return true
    }
    if (path === '__opencove_bridge.js') {
      res.setHeader('content-type', 'text/javascript; charset=utf-8')
      res.end(req.method === 'HEAD' ? undefined : PLUGIN_BRIDGE_SCRIPT)
      return true
    }
    const resource = await plugins.resource(token, path)
    if (!resource) {
      res.statusCode = 404
      res.end()
      return true
    }
    res.setHeader('content-type', resource.contentType)
    let body = Buffer.from(resource.body)
    if (resource.contentType.startsWith('text/html')) {
      const bridge = `<script src="/plugin-assets/${token}/__opencove_bridge.js"></script>`
      const html = body.toString('utf8')
      body = Buffer.from(
        /<head(?:\s[^>]*)?>/i.test(html)
          ? html.replace(/<head(?:\s[^>]*)?>/i, head => `${head}${bridge}`)
          : `${bridge}${html}`,
      )
      res.setHeader(
        'content-security-policy',
        [
          "default-src 'self'",
          "script-src 'self'",
          "style-src 'self'",
          "img-src 'self' data: blob: https:",
          "media-src 'self' blob: https:",
          "connect-src 'self' https: ws: wss:",
          "font-src 'self' data: https:",
          "object-src 'none'",
          "base-uri 'none'",
          "form-action 'none'",
        ].join('; '),
      )
    }
    res.setHeader('content-length', body.length)
    res.statusCode = 200
    res.end(req.method === 'HEAD' ? undefined : body)
  } catch {
    res.statusCode = 404
    res.end()
  }
  return true
}
