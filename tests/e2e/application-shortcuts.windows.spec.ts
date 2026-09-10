import { test } from '@playwright/test'
import { applicationShortcutTests } from './application-shortcuts.helpers'

test.describe('Windows application shortcuts', () => {
  test.skip(process.platform !== 'win32', 'Windows only')
  applicationShortcutTests()
})
