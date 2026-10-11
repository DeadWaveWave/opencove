import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { join, sep } from 'node:path'
import postcss, { type AtRule, type Root } from 'postcss'
import valueParser from 'postcss-value-parser'
import type { PluginThemeDeclaration } from '../domain/pluginTypes'
import type { PluginThemeFont, PluginThemeResources } from '../domain/pluginThemeResources'
import { pluginRelativePath } from '../domain/localPluginValidation'
import { bundleThemeDeclarationAssets, createThemeAssetLoader } from './pluginThemeCssAssets'
import { decodeThemeCss, rewriteThemeAnimations, scopeThemeCss } from './pluginThemeCssSyntax'

const MAX_CSS_BYTES = 256 * 1024
const MAX_RESULT_BYTES = 12 * 1024 * 1024
const ALLOWED_RULES = new Set([
  'media',
  'supports',
  'container',
  'layer',
  'starting-style',
  'font-face',
  'keyframes',
  '-webkit-keyframes',
])

function inspectRules(root: Root): void {
  let count = 0
  root.walk(node => {
    count += 1
    if (count > 10000) {
      throw new Error('Theme stylesheet exceeds 10000 syntax nodes.')
    }
    let depth = 0
    let parent: postcss.Node | undefined = node.parent
    while (parent) {
      depth += 1
      if (depth > 32) {
        throw new Error('Theme CSS nesting exceeds 32 levels.')
      }
      parent = parent.parent
    }
  })
  root.walkAtRules(rule => {
    const name = decodeThemeCss(rule.name).toLowerCase()
    if (!ALLOWED_RULES.has(name)) {
      throw new Error(`Unsupported theme @${name}; bundle imports and avoid global registrations.`)
    }
    rule.name = name
  })
}

function fontFace(rule: AtRule): PluginThemeFont {
  if (rule.parent?.type !== 'root') {
    throw new Error(
      'Theme @font-face must be declared at the stylesheet top level so iframe fonts share the same availability.',
    )
  }
  const declarations = new Map<string, string>()
  rule.walkDecls(declaration => {
    declarations.set(decodeThemeCss(declaration.prop).toLowerCase(), declaration.value)
  })
  const family = valueParser(declarations.get('font-family') ?? '').nodes.filter(
    node => node.type !== 'space' && node.type !== 'comment',
  )
  if (!family.length || family.some(node => !['word', 'string'].includes(node.type))) {
    throw new Error('Theme @font-face requires one font-family.')
  }
  const source = declarations.get('src')
  if (!source || source.length > MAX_RESULT_BYTES) {
    throw new Error('Theme @font-face requires src.')
  }
  const descriptors: NonNullable<PluginThemeFont['descriptors']> = {}
  for (const [css, key] of [
    ['font-style', 'style'],
    ['font-weight', 'weight'],
    ['font-stretch', 'stretch'],
  ] as const) {
    const value = declarations.get(css)
    if (value) {
      if (value.length > 100) {
        throw new Error('Theme font descriptor is too long.')
      }
      descriptors[key] = value
    }
  }
  const display = declarations.get('font-display')
  if (display) {
    if (!['auto', 'block', 'swap', 'fallback', 'optional'].includes(display)) {
      throw new Error('Invalid theme font-display.')
    }
    descriptors.display = display as typeof descriptors.display
  }
  return {
    family: family.map(node => decodeThemeCss(node.value)).join(' '),
    source,
    ...(Object.keys(descriptors).length ? { descriptors } : {}),
  }
}

/** Compiles only the copied artifact. No mutable source paths enter the renderer response. */
export async function compilePluginThemeResources(
  directory: string,
  pluginId: string,
  themes: readonly PluginThemeDeclaration[] = [],
): Promise<PluginThemeResources> {
  const themeStyles: Record<string, string> = {}
  const themeFonts: Record<string, PluginThemeFont[]> = {}
  const load = createThemeAssetLoader(directory)
  let inputBytes = 0
  let resultBytes = 0
  // Bounded, serial IO keeps the aggregate budget authoritative across all contributed themes.
  /* eslint-disable no-await-in-loop */
  for (const theme of themes) {
    if (!theme.stylesheet) {
      continue
    }
    const stylesheet = pluginRelativePath(theme.stylesheet)
    if (!stylesheet.toLowerCase().endsWith('.css')) {
      throw new Error('Theme stylesheet must be a CSS file.')
    }
    const file = await realpath(join(directory, stylesheet))
    const rootDirectory = await realpath(directory)
    if (!file.startsWith(`${rootDirectory}${sep}`)) {
      throw new Error('Theme stylesheet escaped its plugin package.')
    }
    const info = await stat(file)
    if (!info.isFile() || inputBytes + info.size > MAX_CSS_BYTES) {
      throw new Error('Theme stylesheets exceed 256 KiB.')
    }
    const css = await readFile(file, 'utf8')
    inputBytes += Buffer.byteLength(css)
    if (inputBytes > MAX_CSS_BYTES) {
      throw new Error('Theme stylesheets exceed 256 KiB.')
    }
    let root: Root
    try {
      root = postcss.parse(css, { from: file, map: false })
    } catch (error) {
      if (error instanceof postcss.CssSyntaxError) {
        throw new Error(
          `Theme "${pluginId}/${theme.id}", stylesheet "${stylesheet}":${error.line}:${error.column}: ${error.reason}`,
          { cause: error },
        )
      }
      throw error
    }
    root.walkComments(comment => {
      if (/[@#]\s*source(?:Mapping)?URL\s*=/i.test(comment.text)) {
        comment.remove()
      }
    })
    inspectRules(root)
    const declarations: postcss.Declaration[] = []
    root.walkDecls(declaration => {
      declarations.push(declaration)
    })
    for (const declaration of declarations) {
      await bundleThemeDeclarationAssets(declaration, stylesheet, load)
    }
    const uniqueFonts = new Map<string, PluginThemeFont>()
    root.walkAtRules('font-face', rule => {
      const font = fontFace(rule)
      uniqueFonts.set(JSON.stringify(font), font)
    })
    const fonts = [...uniqueFonts.values()]
    if (fonts.length > 32) {
      throw new Error('Theme supports at most 32 font faces.')
    }
    const id = `plugin:${pluginId}:${theme.id}`
    const prefix = `opencove-theme-${createHash('sha256').update(id).digest('hex').slice(0, 16)}`
    rewriteThemeAnimations(root, prefix)
    scopeThemeCss(root, id)
    const compiled = root.toString()
    resultBytes += Buffer.byteLength(JSON.stringify({ style: compiled, fonts }))
    if (resultBytes > MAX_RESULT_BYTES) {
      throw new Error('Compiled theme stylesheets and fonts exceed 12 MiB.')
    }
    themeStyles[theme.id] = compiled
    if (fonts.length) {
      themeFonts[theme.id] = fonts
    }
  }
  /* eslint-enable no-await-in-loop */
  const result = {
    ...(Object.keys(themeStyles).length ? { themeStyles } : {}),
    ...(Object.keys(themeFonts).length ? { themeFonts } : {}),
  }
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_RESULT_BYTES) {
    throw new Error('Compiled theme stylesheets and fonts exceed 12 MiB.')
  }
  return result
}
