import React, { useEffect, useLayoutEffect, useState } from 'react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocumentNodeMonacoEditor } from '../../../src/contexts/workspace/presentation/renderer/components/DocumentNode.monaco'

const monaco = vi.hoisted(() => ({ createModel: vi.fn(), create: vi.fn() }))
vi.mock('monaco-editor/esm/vs/editor/editor.api.js', () => ({
  editor: { ...monaco, setTheme: vi.fn(), EditorOption: { wrappingInfo: 1 } },
  KeyMod: { CtrlCmd: 1, Alt: 2 },
  KeyCode: { KeyS: 3, KeyZ: 4 },
}))
vi.mock('monaco-editor/esm/vs/editor/contrib/find/browser/findController.js', () => ({}))
vi.mock('@app/renderer/i18n', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

function createEditorDouble(initial: string) {
  let value = initial
  let column = 4
  let onChange: () => void = () => undefined
  const model = {
    getValue: () => value,
    getLineCount: () => value.split('\n').length,
    getLineMaxColumn: (line: number) => value.split('\n')[line - 1].length + 1,
    setValue: vi.fn((next: string) => {
      value = next
      column = 1
      onChange()
    }),
    dispose: vi.fn(),
  }
  const editor = {
    getModel: () => model,
    getOption: () => ({ wrappingColumn: -1 }),
    onDidChangeModelContent: (listener: () => void) => {
      onChange = listener
    },
    onDidChangeConfiguration: vi.fn(),
    addAction: vi.fn(),
    setSelection: vi.fn((range: { startColumn: number }) => {
      column = range.startColumn
    }),
    revealRangeInCenter: vi.fn(),
    focus: vi.fn(),
    saveViewState: () => ({ column }),
    restoreViewState: vi.fn((state: { column: number }) => {
      column = state.column
    }),
    dispose: vi.fn(),
  }
  monaco.createModel.mockImplementation((content: string) => {
    value = content
    return model
  })
  monaco.create.mockReturnValue(editor)
  return {
    model,
    editor,
    getColumn: () => column,
    type: (text: string) => {
      const lines = value.split('\n')
      lines[11] = lines[11].slice(0, column - 1) + text + lines[11].slice(column - 1)
      value = lines.join('\n')
      column += text.length
      onChange()
    },
  }
}

const initial = Array.from({ length: 30 }, (_, index) => `line-${index + 1}-content`).join('\n')
const navigation = {
  requestId: 1,
  uri: 'file:///repo/navigation.txt',
  mountId: null,
  line: 12,
  column: 4,
}

describe('DocumentNode Monaco input synchronization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('React', React)
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('keeps text and the caret when typing overtakes a committed content echo', async () => {
    const target = createEditorDouble(initial)
    const onNavigationApplied = vi.fn()
    let afterCommit: (() => void) | undefined
    let afterEffects: (() => void) | undefined
    let draft = initial

    function Harness() {
      const [content, setContent] = useState(initial)
      draft = content
      // Inject input into the commit -> passive effect gap without relying on timers or load.
      useLayoutEffect(() => {
        const pending = afterCommit
        afterCommit = undefined
        pending?.()
      })
      useEffect(() => {
        const pending = afterEffects
        afterEffects = undefined
        pending?.()
      })
      return (
        <DocumentNodeMonacoEditor
          uri={navigation.uri}
          content={content}
          onContentChange={setContent}
          onSaveShortcut={() => undefined}
          navigation={navigation}
          onNavigationApplied={onNavigationApplied}
        />
      )
    }

    render(<Harness />)
    await waitFor(() => expect(onNavigationApplied).toHaveBeenCalledWith(1))
    afterCommit = () => target.type('INK_')
    afterEffects = () => target.type('INSERT_')
    act(() => target.type('L'))

    expect(target.model.getValue().split('\n')[11]).toBe('linLINK_INSERT_e-12-content')
    expect(draft).toBe(target.model.getValue())
    expect(target.getColumn()).toBe(16)
    expect(target.model.setValue).not.toHaveBeenCalled()
    expect(target.editor.setSelection).toHaveBeenCalledTimes(1)
    expect(onNavigationApplied).toHaveBeenCalledTimes(1)
    expect(monaco.createModel).toHaveBeenCalledTimes(1)
  })

  it('still applies an explicit external content replacement without recreating the model', async () => {
    const target = createEditorDouble(initial)
    const onContentChange = vi.fn()
    const props = { uri: navigation.uri, onContentChange, onSaveShortcut: () => undefined }
    const view = render(<DocumentNodeMonacoEditor {...props} content={initial} />)
    await waitFor(() => expect(monaco.create).toHaveBeenCalledTimes(1))
    view.rerender(<DocumentNodeMonacoEditor {...props} content="loaded from disk" />)
    expect(target.model.getValue()).toBe('loaded from disk')
    expect(onContentChange).not.toHaveBeenCalled()
    expect(monaco.createModel).toHaveBeenCalledTimes(1)
  })
})
