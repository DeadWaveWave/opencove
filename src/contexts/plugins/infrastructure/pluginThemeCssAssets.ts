import { readFile, realpath, stat } from 'node:fs/promises'
import { dirname, extname, resolve, sep } from 'node:path'
import valueParser from 'postcss-value-parser'
import type { Declaration } from 'postcss'
import { decodeThemeCss } from './pluginThemeCssSyntax'

function invalidPath(value: string): boolean {
  return value.includes('\\') || [...value].some(character => character.charCodeAt(0) < 32)
}

const TYPES: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
}

export function createThemeAssetLoader(directory: string) {
  const root = resolve(directory)
  const cache = new Map<string, string>()
  let bytes = 0
  let expandedBytes = 0
  return async (stylesheet: string, authored: string): Promise<string> => {
    const value = decodeThemeCss(authored).trim()
    // Package-local fragments are useful for bundled SVG masks, not network resources.
    if (/^#[a-z_][\w.-]*$/i.test(value)) {
      return value
    }
    if (!value || invalidPath(value) || /^(?:[a-z][a-z\d+.-]*:|\/)/i.test(value)) {
      throw new Error('Theme URLs must reference bundled relative assets.')
    }
    const [pathname, fragment] = value.split('#')
    if (
      value.split('#').length > 2 ||
      (fragment && !/^[a-z_][\w.-]*$/i.test(fragment)) ||
      pathname.includes('?')
    ) {
      throw new Error('Theme asset URLs cannot contain query strings or invalid fragments.')
    }
    let decodedPath: string
    try {
      decodedPath = decodeURIComponent(pathname)
    } catch {
      throw new Error('Invalid encoded theme asset path.')
    }
    if (invalidPath(decodedPath)) {
      throw new Error('Invalid theme asset path.')
    }
    const path = resolve(root, dirname(stylesheet), decodedPath)
    if (!path.startsWith(`${root}${sep}`)) {
      throw new Error('Theme asset escaped its plugin package.')
    }
    const actual = await realpath(path)
    const actualRoot = await realpath(root)
    if (!actual.startsWith(`${actualRoot}${sep}`)) {
      throw new Error('Theme asset escaped its plugin package.')
    }
    const type = TYPES[extname(path).toLowerCase()]
    if (!type) {
      throw new Error('Unsupported theme asset type.')
    }
    let data = cache.get(actual)
    if (!data) {
      const info = await stat(actual)
      if (!info.isFile() || info.size + bytes > 8 * 1024 * 1024) {
        throw new Error('Theme resources exceed 8 MiB.')
      }
      const body = await readFile(actual)
      bytes += body.byteLength
      if (bytes > 8 * 1024 * 1024) {
        throw new Error('Theme resources exceed 8 MiB.')
      }
      data = `data:${type};base64,${body.toString('base64')}`
      cache.set(actual, data)
    }
    expandedBytes += data.length
    if (expandedBytes > 12 * 1024 * 1024) {
      throw new Error('Compiled theme resources exceed 12 MiB.')
    }
    return fragment ? `${data}#${fragment}` : data
  }
}

export async function bundleThemeDeclarationAssets(
  declaration: Declaration,
  stylesheet: string,
  load: ReturnType<typeof createThemeAssetLoader>,
): Promise<void> {
  const parsed = valueParser(declaration.value)
  const pending: Array<() => Promise<void>> = []
  parsed.walk(node => {
    if ('unclosed' in node && node.unclosed) {
      throw new Error('Unclosed theme CSS value.')
    }
    if (node.type !== 'function') {
      return
    }
    const name = decodeThemeCss(node.value).toLowerCase()
    if (name === 'image-set' || name === '-webkit-image-set') {
      // String forms of image-set() are URLs too. Canonicalize them before bundling.
      for (const child of node.nodes) {
        if (child.type === 'string') {
          pending.push(() =>
            load(stylesheet, child.value).then(value => {
              child.value = value
            }),
          )
        }
      }
    }
    if (name !== 'url') {
      return
    }
    const values = node.nodes.filter(child => child.type !== 'space' && child.type !== 'comment')
    if (values.length !== 1 || !['word', 'string'].includes(values[0].type)) {
      throw new Error('Theme url() must contain one bundled resource path.')
    }
    pending.push(() =>
      load(stylesheet, values[0].value).then(value => {
        node.value = 'url'
        node.nodes = [{ type: 'string', quote: '"', value, sourceIndex: 0, sourceEndIndex: 0 }]
      }),
    )
    return false
  })
  // Serial resource reads bound peak memory as well as response size.
  for (const resolveAsset of pending) {
    // eslint-disable-next-line no-await-in-loop
    await resolveAsset()
  }
  declaration.value = parsed.toString()
}
