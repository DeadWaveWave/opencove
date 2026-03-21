import React, { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TaskCreatorState } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/types'
import { TaskCreatorWindow } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/windows/TaskCreatorWindow'

describe('TaskCreatorWindow advanced settings', () => {
  it('keeps advanced settings visible while typing task title', async () => {
    const closeTaskCreator = vi.fn()
    const generateTaskTitle = vi.fn(async () => undefined)
    const createTask = vi.fn(async () => undefined)

    function Harness() {
      const [taskCreator, setTaskCreator] = useState<TaskCreatorState | null>({
        anchor: { x: 120, y: 80 },
        title: '',
        requirement: '',
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
          taskTitleModelLabel="gpt-5.2"
          taskTagOptions={[]}
          setTaskCreator={setTaskCreator}
          closeTaskCreator={closeTaskCreator}
          generateTaskTitle={generateTaskTitle}
          createTask={createTask}
        />
      )
    }

    render(<Harness />)

    fireEvent.click(screen.getByTestId('workspace-task-advanced-toggle'))

    const titleInput = await screen.findByTestId('workspace-task-title')

    fireEvent.change(titleInput, { target: { value: 'My Task Title' } })

    await waitFor(() => {
      expect(screen.getByTestId('workspace-task-title')).toBeInTheDocument()
    })

    expect((screen.getByTestId('workspace-task-title') as HTMLInputElement).value).toBe(
      'My Task Title',
    )
  })
})
