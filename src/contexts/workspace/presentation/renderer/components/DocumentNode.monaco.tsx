import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { decodeUriPathname } from './DocumentNode.helpers'
import {
  DOCUMENT_NODE_MONACO_DARK_THEME,
  resolveDocumentNodeMonacoThemeId,
} from './DocumentNode.monacoTheme'

import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker.js?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker.js?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker.js?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker.js?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker.js?worker'

type MonacoModule = typeof import('monaco-editor/esm/vs/editor/editor.api.js')
type MonacoEditorInstance =
  import('monaco-editor/esm/vs/editor/editor.api.js').editor.IStandaloneCodeEditor
type MonacoTextModel = import('monaco-editor/esm/vs/editor/editor.api.js').editor.ITextModel

type MonacoEnvironmentTarget = typeof globalThis & {
  MonacoEnvironment?: {
    getWorker: (workerId: string, label: string) => Worker
  }
}

const BASIC_LANGUAGE_LOADERS: Record<string, () => Promise<unknown>> = {
  css: () => import('monaco-editor/esm/vs/language/css/monaco.contribution.js'),
  go: () => import('monaco-editor/esm/vs/basic-languages/go/go.contribution.js'),
  html: () => import('monaco-editor/esm/vs/language/html/monaco.contribution.js'),
  ini: () => import('monaco-editor/esm/vs/basic-languages/ini/ini.contribution.js'),
  java: () => import('monaco-editor/esm/vs/basic-languages/java/java.contribution.js'),
  javascript: () => import('monaco-editor/esm/vs/language/typescript/monaco.contribution.js'),
  json: () => import('monaco-editor/esm/vs/language/json/monaco.contribution.js'),
  markdown: () => import('monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js'),
  python: () => import('monaco-editor/esm/vs/basic-languages/python/python.contribution.js'),
  rust: () => import('monaco-editor/esm/vs/basic-languages/rust/rust.contribution.js'),
  shell: () => import('monaco-editor/esm/vs/basic-languages/shell/shell.contribution.js'),
  sql: () => import('monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js'),
  typescript: () => import('monaco-editor/esm/vs/language/typescript/monaco.contribution.js'),
  xml: () => import('monaco-editor/esm/vs/basic-languages/xml/xml.contribution.js'),
  yaml: () => import('monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js'),
}

const loadedLanguageIds = new Map<string, Promise<void>>()
let monacoModulePromise: Promise<MonacoModule> | null = null

function ensureMonacoEnvironment(): void {
  const target = globalThis as MonacoEnvironmentTarget
  if (target.MonacoEnvironment) {
    return
  }

  target.MonacoEnvironment = {
    getWorker: (_workerId, label) => {
      if (label === 'json') {
        return new jsonWorker()
      }

      if (label === 'css' || label === 'scss' || label === 'less') {
        return new cssWorker()
      }

      if (label === 'html' || label === 'handlebars' || label === 'razor') {
        return new htmlWorker()
      }

      if (label === 'typescript' || label === 'javascript') {
        return new tsWorker()
      }

      return new editorWorker()
    },
  }
}

async function loadMonacoModule(): Promise<MonacoModule> {
  ensureMonacoEnvironment()

  if (!monacoModulePromise) {
    monacoModulePromise = import('monaco-editor/esm/vs/editor/editor.api.js')
  }

  return await monacoModulePromise
}

function getCurrentDocumentNodeMonacoThemeId(): string {
  if (typeof document === 'undefined') {
    return DOCUMENT_NODE_MONACO_DARK_THEME
  }

  return resolveDocumentNodeMonacoThemeId(document.documentElement.dataset.coveTheme)
}

async function syncDocumentNodeMonacoTheme(): Promise<void> {
  const monaco = await loadMonacoModule()
  monaco.editor.setTheme(getCurrentDocumentNodeMonacoThemeId())
}

async function ensureDocumentNodeLanguage(languageId: string): Promise<void> {
  const loadLanguage = BASIC_LANGUAGE_LOADERS[languageId]
  if (!loadLanguage) {
    return
  }

  let promise = loadedLanguageIds.get(languageId)
  if (!promise) {
    promise = loadLanguage().then(() => undefined)
    loadedLanguageIds.set(languageId, promise)
  }

  await promise
}

export function resolveDocumentNodeLanguageId(uri: string): string {
  const normalizedPath = decodeUriPathname(uri).toLowerCase()

  if (
    normalizedPath.endsWith('.ts') ||
    normalizedPath.endsWith('.tsx') ||
    normalizedPath.endsWith('.mts') ||
    normalizedPath.endsWith('.cts')
  ) {
    return 'typescript'
  }

  if (
    normalizedPath.endsWith('.js') ||
    normalizedPath.endsWith('.jsx') ||
    normalizedPath.endsWith('.mjs') ||
    normalizedPath.endsWith('.cjs')
  ) {
    return 'javascript'
  }

  if (normalizedPath.endsWith('.json') || normalizedPath.endsWith('.jsonc')) {
    return 'json'
  }

  if (
    normalizedPath.endsWith('.md') ||
    normalizedPath.endsWith('.markdown') ||
    normalizedPath.endsWith('.mdx')
  ) {
    return 'markdown'
  }

  if (
    normalizedPath.endsWith('.html') ||
    normalizedPath.endsWith('.htm') ||
    normalizedPath.endsWith('.xhtml')
  ) {
    return 'html'
  }

  if (normalizedPath.endsWith('.xml') || normalizedPath.endsWith('.svg')) {
    return 'xml'
  }

  if (
    normalizedPath.endsWith('.css') ||
    normalizedPath.endsWith('.scss') ||
    normalizedPath.endsWith('.less')
  ) {
    return 'css'
  }

  if (normalizedPath.endsWith('.yaml') || normalizedPath.endsWith('.yml')) {
    return 'yaml'
  }

  if (
    normalizedPath.endsWith('.sh') ||
    normalizedPath.endsWith('.bash') ||
    normalizedPath.endsWith('.zsh')
  ) {
    return 'shell'
  }

  if (normalizedPath.endsWith('.py')) {
    return 'python'
  }

  if (normalizedPath.endsWith('.go')) {
    return 'go'
  }

  if (normalizedPath.endsWith('.rs')) {
    return 'rust'
  }

  if (normalizedPath.endsWith('.java')) {
    return 'java'
  }

  if (normalizedPath.endsWith('.sql')) {
    return 'sql'
  }

  if (
    normalizedPath.endsWith('.ini') ||
    normalizedPath.endsWith('.cfg') ||
    normalizedPath.endsWith('.conf')
  ) {
    return 'ini'
  }

  return 'plaintext'
}

export function DocumentNodeMonacoEditor({
  uri,
  content,
  onContentChange,
  onSaveShortcut,
}: {
  uri: string
  content: string
  onContentChange: (nextContent: string) => void
  onSaveShortcut: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const languageId = useMemo(() => resolveDocumentNodeLanguageId(uri), [uri])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const hostRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<MonacoEditorInstance | null>(null)
  const modelRef = useRef<MonacoTextModel | null>(null)
  const suppressChangeRef = useRef(false)
  const onContentChangeRef = useRef(onContentChange)
  const onSaveShortcutRef = useRef(onSaveShortcut)
  const latestContentRef = useRef(content)
  latestContentRef.current = content
  onContentChangeRef.current = onContentChange
  onSaveShortcutRef.current = onSaveShortcut

  useEffect(() => {
    let disposed = false

    const attachEditor = async (): Promise<void> => {
      try {
        const [monaco] = await Promise.all([
          loadMonacoModule(),
          ensureDocumentNodeLanguage(languageId),
        ])

        if (disposed || !hostRef.current) {
          return
        }

        monaco.editor.setTheme(getCurrentDocumentNodeMonacoThemeId())

        const model = monaco.editor.createModel(latestContentRef.current, languageId)
        modelRef.current = model

        const editor = monaco.editor.create(hostRef.current, {
          automaticLayout: true,
          fontSize: 12,
          glyphMargin: false,
          lineHeight: 18,
          lineNumbers: 'on',
          minimap: { enabled: false },
          model,
          padding: { top: 12, bottom: 12 },
          renderLineHighlight: 'line',
          scrollBeyondLastLine: false,
          tabSize: 2,
          wordWrap: 'off',
        })

        editorRef.current = editor

        const input = hostRef.current.querySelector('textarea.inputarea')
        if (input instanceof HTMLTextAreaElement) {
          input.setAttribute('data-testid', 'document-node-editor-input')
          input.setAttribute('spellcheck', 'false')
        }

        editor.onDidChangeModelContent(() => {
          if (suppressChangeRef.current) {
            return
          }

          onContentChangeRef.current(model.getValue())
        })

        editor.onKeyDown(event => {
          const browserEvent = event.browserEvent
          const isSaveShortcut =
            browserEvent.key.toLowerCase() === 's' && (browserEvent.metaKey || browserEvent.ctrlKey)

          if (!isSaveShortcut) {
            return
          }

          browserEvent.preventDefault()
          browserEvent.stopPropagation()
          onSaveShortcutRef.current()
        })

        setStatus('ready')
      } catch {
        if (!disposed) {
          setStatus('error')
        }
      }
    }

    setStatus('loading')
    void attachEditor()

    return () => {
      disposed = true
      editorRef.current?.dispose()
      editorRef.current = null

      modelRef.current?.dispose()
      modelRef.current = null
    }
  }, [languageId, uri])

  useEffect(() => {
    const editor = editorRef.current
    const model = modelRef.current
    if (!editor || !model) {
      return
    }

    if (model.getValue() === content) {
      return
    }

    const viewState = editor.saveViewState()
    suppressChangeRef.current = true
    try {
      model.setValue(content)
    } finally {
      suppressChangeRef.current = false
    }
    editor.restoreViewState(viewState)
  }, [content])

  useEffect(() => {
    const model = modelRef.current
    if (!model) {
      return
    }

    void (async () => {
      try {
        await ensureDocumentNodeLanguage(languageId)
        const monaco = await loadMonacoModule()
        if (modelRef.current !== model) {
          return
        }

        monaco.editor.setModelLanguage(model, languageId)
      } catch {
        // Ignore language update failures; the editor still renders plain text.
      }
    })()
  }, [languageId])

  useEffect(() => {
    if (status !== 'ready') {
      return
    }

    let disposed = false
    const handleThemeChange = () => {
      if (disposed) {
        return
      }

      void syncDocumentNodeMonacoTheme()
    }

    handleThemeChange()
    window.addEventListener('opencove-theme-changed', handleThemeChange)
    return () => {
      disposed = true
      window.removeEventListener('opencove-theme-changed', handleThemeChange)
    }
  }, [status])

  if (status === 'error') {
    return (
      <div className="document-node__state document-node__state--error">
        <div className="document-node__state-title">{t('common.error')}</div>
        <div className="document-node__state-message">{t('documentNode.editorUnavailable')}</div>
      </div>
    )
  }

  return (
    <div className="document-node__monaco-shell" data-testid="document-node-editor">
      <div ref={hostRef} className="document-node__monaco nodrag nowheel" />
      {status !== 'ready' ? (
        <div className="document-node__editor-loading" role="status">
          {t('common.loading')}
        </div>
      ) : null}
    </div>
  )
}
