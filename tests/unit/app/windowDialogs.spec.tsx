import React, { useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeleteProjectDialog } from '../../../src/app/renderer/shell/components/DeleteProjectDialog'
import { TaskCreatorWindow } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/windows/TaskCreatorWindow'
import type { TaskCreatorState } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/types'

function TaskCreatorHarness() {
  const [taskCreator, setTaskCreator] = useState<TaskCreatorState | null>({
    anchor: { x: 120, y: 80 },
    title: '',
    requirement: 'Keep this draft',
    priority: 'medium',
    selectedTags: [],
    autoGenerateTitle: false,
    isGeneratingTitle: false,
    isCreating: false,
    error: null,
  })

  return (
    <TaskCreatorWindow
      taskCreator={taskCreator}
      taskTitleProviderLabel="Codex"
      taskTitleModelLabel="default"
      taskTagOptions={[]}
      setTaskCreator={setTaskCreator}
      closeTaskCreator={() => setTaskCreator(null)}
      generateTaskTitle={async () => undefined}
      createTask={async () => undefined}
    />
  )
}

describe('Window dialogs', () => {
  afterEach(() => vi.useRealTimers())

  it('focuses cancel for deletion and restores the trigger after Escape', () => {
    vi.useFakeTimers()
    const onConfirm = vi.fn()
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>Remove project</button>
          {open ? (
            <DeleteProjectDialog
              workspaceName="OpenCove"
              isRemoving={false}
              onCancel={() => setOpen(false)}
              onConfirm={onConfirm}
            />
          ) : null}
        </>
      )
    }

    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Remove project' })
    trigger.focus()
    fireEvent.click(trigger)
    act(() => vi.runOnlyPendingTimers())
    expect(screen.getByRole('alertdialog')).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByTestId('workspace-project-delete-cancel')).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true })
    expect(screen.getByTestId('workspace-project-delete-confirm')).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    act(() => vi.runOnlyPendingTimers())
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('does not dismiss a deletion while its existing owner is removing', () => {
    const onCancel = vi.fn()
    render(
      <DeleteProjectDialog
        workspaceName="OpenCove"
        isRemoving
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.pointerDown(screen.getByRole('alertdialog').parentElement!)
    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByTestId('workspace-project-delete-confirm')).toBeDisabled()
  })

  it('closes only the top nested template dialog and preserves the task draft', () => {
    vi.useFakeTimers()
    render(<TaskCreatorHarness />)
    act(() => vi.runOnlyPendingTimers())
    const requirement = screen.getByTestId('workspace-task-requirement')
    expect(requirement).toHaveFocus()

    fireEvent.click(screen.getByTestId('workspace-task-creator-open-prompt-templates'))
    act(() => vi.runOnlyPendingTimers())
    const addTemplate = screen.getByTestId('task-creator-prompt-templates-add-global')
    addTemplate.focus()
    expect(addTemplate).toHaveFocus()
    fireEvent.click(addTemplate)
    act(() => vi.runOnlyPendingTimers())
    expect(screen.getAllByRole('dialog')).toHaveLength(2)
    fireEvent.keyDown(document, { key: 'Escape' })
    act(() => vi.runOnlyPendingTimers())

    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(requirement).toHaveValue('Keep this draft')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
