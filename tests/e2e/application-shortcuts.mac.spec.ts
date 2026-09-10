import { test } from '@playwright/test'
import { applicationShortcutTests } from './application-shortcuts.helpers'

test.describe('macOS application shortcuts', () => {
  test.skip(process.platform !== 'darwin', 'macOS only')
  applicationShortcutTests()
})
