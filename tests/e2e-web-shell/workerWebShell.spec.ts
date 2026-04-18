import { expect, test, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || value.trim().length === 0) {
    throw new Error(`[web-shell-e2e] Missing required env var: ${name}`)
  }

  return value
}

async function readOutputJson(page: Page): Promise<unknown> {
  const outputText = (await page.locator('#output').textContent()) ?? ''
  const trimmed = outputText.trim()
  if (trimmed.length === 0) {
    return null
  }

  return JSON.parse(trimmed) as unknown
}

test.describe('Worker web shell', () => {
  test('loads the shell page', async ({ page }) => {
    const token = requireEnv('OPENCOVE_WEB_SHELL_TOKEN')
    await page.goto(`/debug/shell?token=${encodeURIComponent(token)}`)

    await expect(page).toHaveTitle('OpenCove Worker Shell')
    await expect(page.locator('#token')).toBeVisible()
    await expect(page.locator('#ping')).toBeVisible()
    await expect(page.locator('#send')).toBeVisible()
    await expect(page.locator('#watchSync')).toBeVisible()
    await expect(page.locator('#output')).toBeVisible()
  })

  test('ping works with a valid token', async ({ page }) => {
    const token = requireEnv('OPENCOVE_WEB_SHELL_TOKEN')
    await page.goto(`/debug/shell?token=${encodeURIComponent(token)}`)

    await page.locator('#ping').click()
    await expect(page.locator('#output')).not.toHaveText('')

    const result = (await readOutputJson(page)) as {
      httpStatus?: number
      data?: { ok?: boolean }
    }

    expect(result.httpStatus).toBe(200)
    expect(result.data?.ok).toBe(true)
  })

  test('ping fails with 401 when token is invalid', async ({ page }) => {
    await page.goto('/debug/shell?token=invalid-token')

    await page.locator('#ping').click()
    await expect(page.locator('#output')).not.toHaveText('')

    const result = (await readOutputJson(page)) as {
      httpStatus?: number
      data?: { ok?: boolean; error?: { code?: string } }
    }

    expect(result.httpStatus).toBe(401)
    expect(result.data?.ok).toBe(false)
    expect(result.data?.error?.code).toBe('control_surface.unauthorized')
  })

  test('can read an approved file via filesystem.readFileText', async ({ page }) => {
    const token = requireEnv('OPENCOVE_WEB_SHELL_TOKEN')
    const fileUri = requireEnv('OPENCOVE_WEB_SHELL_TEST_FILE_URI')

    await page.goto(`/debug/shell?token=${encodeURIComponent(token)}`)

    await page.locator('#kind').selectOption('query')
    await page.locator('#opId').fill('filesystem.readFileText')
    await page.locator('#payload').fill(JSON.stringify({ uri: fileUri }))

    await page.locator('#send').click()
    await expect(page.locator('#output')).not.toHaveText('')

    const result = (await readOutputJson(page)) as {
      httpStatus?: number
      data?: { ok?: boolean; value?: { content?: string } }
    }

    expect(result.httpStatus).toBe(200)
    expect(result.data?.ok).toBe(true)
    expect(result.data?.value?.content).toBe('hello from opencove web shell e2e\n')
  })

  test('does not expose desktop-only open-path actions via control surface', async ({ page }) => {
    const token = requireEnv('OPENCOVE_WEB_SHELL_TOKEN')
    await page.goto(`/debug/shell?token=${encodeURIComponent(token)}`)

    await page.locator('#kind').selectOption('command')
    await page.locator('#opId').fill('workspace.openPath')
    await page.locator('#payload').fill(JSON.stringify({ path: '/tmp', openerId: 'finder' }))

    await page.locator('#send').click()
    await expect(page.locator('#output')).not.toHaveText('')

    const result = (await readOutputJson(page)) as {
      httpStatus?: number
      data?: { ok?: boolean; error?: { code?: string } }
    }

    expect(result.httpStatus).toBe(200)
    expect(result.data?.ok).toBe(false)
    expect(result.data?.error?.code).toBe('common.invalid_input')
  })

  test('emits sync events for note.create', async ({ page }) => {
    const token = requireEnv('OPENCOVE_WEB_SHELL_TOKEN')
    const testFileUri = requireEnv('OPENCOVE_WEB_SHELL_TEST_FILE_URI')
    const workspacePath = dirname(fileURLToPath(new URL(testFileUri)))
    const workspaceId = randomUUID()
    const spaceId = randomUUID()

    const initialState = {
      formatVersion: 1,
      activeWorkspaceId: workspaceId,
      workspaces: [
        {
          id: workspaceId,
          name: 'Test Workspace',
          path: workspacePath,
          worktreesRoot: workspacePath,
          pullRequestBaseBranchOptions: [],
          spaceArchiveRecords: [],
          viewport: { x: 0, y: 0, zoom: 1 },
          isMinimapVisible: true,
          spaces: [
            {
              id: spaceId,
              name: 'Main',
              directoryPath: workspacePath,
              labelColor: null,
              nodeIds: [],
              rect: null,
            },
          ],
          activeSpaceId: spaceId,
          nodes: [],
        },
      ],
      settings: {},
    }

    await page.goto(`/debug/shell?token=${encodeURIComponent(token)}`)

    const baseStateResponse = await page.request.post('/invoke', {
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      data: { kind: 'query', id: 'sync.state', payload: null },
    })
    expect(baseStateResponse.status()).toBe(200)
    const baseStateEnvelope = (await baseStateResponse.json()) as {
      ok?: boolean
      value?: { revision?: number }
    }
    expect(baseStateEnvelope.ok).toBe(true)
    const baseRevision = baseStateEnvelope.value?.revision ?? 0

    const writeStateResponse = await page.request.post('/invoke', {
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      data: {
        kind: 'command',
        id: 'sync.writeState',
        payload: { state: initialState, baseRevision },
      },
    })
    expect(writeStateResponse.status()).toBe(200)

    const stateAfterWrite = (await (
      await page.request.post('/invoke', {
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        data: { kind: 'query', id: 'sync.state', payload: null },
      })
    ).json()) as { ok?: boolean; value?: { revision?: number } }

    expect(stateAfterWrite.ok).toBe(true)
    const revisionBefore = stateAfterWrite.value?.revision ?? 0
    expect(revisionBefore).toBeGreaterThan(0)

    const syncEventPromise = page.evaluate(
      ({ token: authToken, afterRevision }) =>
        new Promise((resolve, reject) => {
          const url =
            '/events?token=' +
            encodeURIComponent(authToken) +
            '&afterRevision=' +
            String(afterRevision)
          const source = new EventSource(url)

          const timer = setTimeout(() => {
            source.close()
            reject(new Error('Timed out waiting for sync event'))
          }, 7_500)

          source.addEventListener('opencove.sync', event => {
            try {
              const parsed = JSON.parse(event.data)
              if (
                parsed &&
                typeof parsed.revision === 'number' &&
                parsed.revision > afterRevision
              ) {
                clearTimeout(timer)
                source.close()
                resolve(parsed)
              }
            } catch {
              // ignore invalid payload
            }
          })

          source.addEventListener('error', () => {
            // allow reconnect attempts
          })
        }),
      { token, afterRevision: revisionBefore },
    )

    const createNoteResponse = await page.request.post('/invoke', {
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      data: {
        kind: 'command',
        id: 'note.create',
        payload: { spaceId, text: 'hello from sync test', x: 10, y: 20 },
      },
    })
    expect(createNoteResponse.status()).toBe(200)

    const syncEvent = syncEventPromise as unknown as Promise<{ type?: string; revision?: number }>
    const payload = await syncEvent
    expect(payload.type).toBe('app_state.updated')
    expect(payload.revision).toBeGreaterThan(revisionBefore)

    const spaceGet = (await (
      await page.request.post('/invoke', {
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        data: { kind: 'query', id: 'space.get', payload: { spaceId } },
      })
    ).json()) as { ok?: boolean; value?: { space?: { nodes?: { kind?: string }[] } } }

    expect(spaceGet.ok).toBe(true)
    expect(spaceGet.value?.space?.nodes?.some(node => node.kind === 'note')).toBe(true)
  })

  test('pty streaming reconnect replays output', async ({ page }) => {
    const token = requireEnv('OPENCOVE_WEB_SHELL_TOKEN')
    const testFileUri = requireEnv('OPENCOVE_WEB_SHELL_TEST_FILE_URI')
    const workspacePath = dirname(fileURLToPath(new URL(testFileUri)))
    const workspaceId = randomUUID()
    const spaceId = randomUUID()

    const initialState = {
      formatVersion: 1,
      activeWorkspaceId: workspaceId,
      workspaces: [
        {
          id: workspaceId,
          name: 'Test Workspace',
          path: workspacePath,
          worktreesRoot: workspacePath,
          pullRequestBaseBranchOptions: [],
          spaceArchiveRecords: [],
          viewport: { x: 0, y: 0, zoom: 1 },
          isMinimapVisible: true,
          spaces: [
            {
              id: spaceId,
              name: 'Main',
              directoryPath: workspacePath,
              labelColor: null,
              nodeIds: [],
              rect: null,
            },
          ],
          activeSpaceId: spaceId,
          nodes: [],
        },
      ],
      settings: {},
    }

    await page.goto(`/debug/shell?token=${encodeURIComponent(token)}`)

    const baseStateResponse = await page.request.post('/invoke', {
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      data: { kind: 'query', id: 'sync.state', payload: null },
    })
    expect(baseStateResponse.status()).toBe(200)
    const baseStateEnvelope = (await baseStateResponse.json()) as {
      ok?: boolean
      value?: { revision?: number }
    }
    expect(baseStateEnvelope.ok).toBe(true)
    const baseRevision = baseStateEnvelope.value?.revision ?? 0

    const writeStateResponse = await page.request.post('/invoke', {
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      data: {
        kind: 'command',
        id: 'sync.writeState',
        payload: { state: initialState, baseRevision },
      },
    })
    expect(writeStateResponse.status()).toBe(200)

    const spawnTerminalResponse = await page.request.post('/invoke', {
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      data: {
        kind: 'command',
        id: 'session.spawnTerminal',
        payload: { spaceId, cols: 80, rows: 24, runtime: 'node' },
      },
    })
    expect(spawnTerminalResponse.status()).toBe(200)

    const spawnResult = (await spawnTerminalResponse.json()) as {
      ok?: boolean
      value?: { sessionId?: string }
    }
    expect(spawnResult.ok).toBe(true)

    const sessionId = spawnResult.value?.sessionId ?? null
    expect(typeof sessionId).toBe('string')
    expect((sessionId ?? '').length).toBeGreaterThan(0)

    await page.locator('#ptySessionId').fill(sessionId ?? '')
    await page.locator('#ptyConnect').click()

    await expect(page.locator('#ptyOutput')).toContainText('[connected]', { timeout: 15_000 })
    await expect(page.locator('#ptyRole')).toHaveText('controller', { timeout: 15_000 })

    await page.locator('#ptyInput').fill("console.log('stream-ok')")
    await page.locator('#ptyInput').press('Enter')
    await expect(page.locator('#ptyOutput')).toContainText('stream-ok', { timeout: 15_000 })

    await page
      .locator('#ptyInput')
      .fill("setTimeout(() => console.log('replay-ok'), 800); console.log('scheduled-ok')")
    await page.locator('#ptyInput').press('Enter')
    await expect(page.locator('#ptyOutput')).toContainText('scheduled-ok', { timeout: 15_000 })

    await page.locator('#ptyDisconnect').click()
    await page.waitForTimeout(50)

    await page.reload()
    await page.waitForTimeout(1_100)
    await page.locator('#ptySessionId').fill(sessionId ?? '')
    await page.locator('#ptyConnect').click()

    await expect(page.locator('#ptyOutput')).toContainText('replay-ok', { timeout: 15_000 })
  })
})
