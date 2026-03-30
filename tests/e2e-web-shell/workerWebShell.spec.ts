import { expect, test } from '@playwright/test'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || value.trim().length === 0) {
    throw new Error(`[web-shell-e2e] Missing required env var: ${name}`)
  }

  return value
}

async function readOutputJson(page: { locator: (selector: string) => any }): Promise<unknown> {
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
    await page.goto(`/?token=${encodeURIComponent(token)}`)

    await expect(page).toHaveTitle('OpenCove Worker Shell')
    await expect(page.locator('#token')).toBeVisible()
    await expect(page.locator('#ping')).toBeVisible()
    await expect(page.locator('#send')).toBeVisible()
    await expect(page.locator('#output')).toBeVisible()
  })

  test('ping works with a valid token', async ({ page }) => {
    const token = requireEnv('OPENCOVE_WEB_SHELL_TOKEN')
    await page.goto(`/?token=${encodeURIComponent(token)}`)

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
    await page.goto('/?token=invalid-token')

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

    await page.goto(`/?token=${encodeURIComponent(token)}`)

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
    await page.goto(`/?token=${encodeURIComponent(token)}`)

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
})
