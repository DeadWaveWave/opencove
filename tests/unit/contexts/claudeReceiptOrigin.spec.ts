// @vitest-environment node
import { expect, it } from 'vitest'
import { receiptOriginCases } from '../../support/claudeClearProperty/replay'
import { runClearCase } from '../../support/claudeClearProperty/run'
it('keeps End-origin and active-window receipt replays below saturation fail-closed', async () => {
  for (const value of receiptOriginCases(3028287489)) {
    // oxlint-disable-next-line no-await-in-loop -- isolated invocation and deterministic delivery order
    const result = await runClearCase(value)
    expect(
      result.errors,
      JSON.stringify({ index: value.index, errors: result.errors }, null, 2),
    ).toEqual([])
  }
})
