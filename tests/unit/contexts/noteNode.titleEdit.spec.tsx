import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import { NoteNode } from '../../../src/contexts/workspace/presentation/renderer/components/NoteNode'

function renderNoteNode(options: {
  title: string
  onTitleChange?: (title: string) => void
}): ReturnType<typeof render> {
  return render(
    <ReactFlowProvider>
      <NoteNode
        title={options.title}
        text=""
        position={{ x: 0, y: 0 }}
        width={240}
        height={180}
        saveDirectoryPath="/tmp"
        onClose={() => undefined}
        onResize={() => undefined}
        onTextChange={() => undefined}
        onTitleChange={options.onTitleChange ?? (() => undefined)}
      />
    </ReactFlowProvider>,
  )
}

describe('NoteNode title editing', () => {
  it('commits a trimmed title when Enter is pressed', () => {
    const onTitleChange = vi.fn()
    renderNoteNode({ title: 'note', onTitleChange })

    fireEvent.click(screen.getByTestId('note-node-title-display'))
    const input = screen.getByTestId('note-node-title-input')
    fireEvent.change(input, { target: { value: '  Custom title  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.blur(input)

    expect(onTitleChange).toHaveBeenCalledWith('Custom title')
  })

  it('cancels the draft when Escape is pressed', () => {
    const onTitleChange = vi.fn()
    renderNoteNode({ title: 'Original title', onTitleChange })

    fireEvent.click(screen.getByTestId('note-node-title-display'))
    const input = screen.getByTestId('note-node-title-input')
    fireEvent.change(input, { target: { value: 'Discard me' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    fireEvent.blur(input)

    expect(onTitleChange).not.toHaveBeenCalled()
    expect(screen.queryByTestId('note-node-title-input')).not.toBeInTheDocument()
    expect(screen.getByTestId('note-node-title-display')).toHaveTextContent('Original title')
  })

  it('shows the untitled placeholder for an empty title', () => {
    renderNoteNode({ title: '' })

    expect(screen.getByTestId('note-node-title-display')).toHaveTextContent('Untitled note')
  })
})
