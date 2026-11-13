import type { Page, TestInfo } from '@playwright/test'

/** Output-only evidence is opt-in; assertion inputs must never use this switch. */
export function isE2EDiagnosticsEnabled(): boolean {
  return process.env.OPENCOVE_E2E_DIAGNOSTICS === '1'
}

/** Call from catch, while the manually launched Electron page is still open. */
export async function attachFailureFrame(page: Page, testInfo: TestInfo): Promise<void> {
  try {
    await testInfo.attach('failure-final-frame', {
      body: await page.screenshot({ animations: 'allow', timeout: 2_000 }),
      contentType: 'image/png',
    })
  } catch {
    // A closed/crashed page must not mask the original failure or prevent app cleanup.
  }
}
