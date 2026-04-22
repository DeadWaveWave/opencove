# Terminal Zoom Clarity Design

Date: 2026-04-22
Status: Approved for spec review
Scope: Renderer-only redesign for terminal zoom clarity without changing product zoom semantics

## 1. Problem Class

This is not primarily a CSS styling problem. It is a renderer re-rasterization problem in a transformed canvas environment.

OpenCove's existing product behavior is:

- Terminal and agent nodes follow canvas zoom visually.
- After zoom-in, the terminal window and glyphs look larger on screen.
- That zoom behavior is existing product logic and must not change.

The bug class is narrower:

- After canvas zoom, terminal rendering can become blurry because the screen-space presentation grows while the xterm backing raster does not get a matching clarity refresh.
- Previous attempts improved clarity but coupled the refresh path to scroll state, bottom-of-buffer heuristics, DOM changes, or layout paths that destabilized scroll/focus behavior.

The design goal is therefore:

- Preserve existing zoom semantics.
- Restore sharp terminal rendering after zoom.
- Do not break scroll, focus, selection, click, IME, or session ownership semantics.

## 2. Reference Summary

### 2.1 Industry / Upstream Signal

This problem class has clear prior art in canvas/WebGL terminal renderers:

- xterm's DPR handling is renderer-driven, not a normal `fit/resize` concern.
- xterm's renderer updates in response to browser DPR changes through renderer measurement and redraw paths.
- That means OpenCove should treat zoom clarity as a renderer refresh problem, not as a layout ownership or terminal lifecycle problem.

Observed from local dependency sources:

- `node_modules/@xterm/xterm/src/browser/services/CoreBrowserService.ts`
  - `dpr` is sourced from the browser window's device pixel ratio.
- `node_modules/@xterm/xterm/src/browser/services/RenderService.ts`
  - DPR changes route through `handleDevicePixelRatioChange()`.
- `node_modules/@xterm/addon-webgl/src/WebglRenderer.ts`
  - WebGL DPR updates lead to renderer resize/rebuild behavior and atlas refresh.

### 2.2 OpenCove Prior Attempts

Recent local evidence:

- `task.md`
  - `T-035` already proved that `effectiveDpr = window.devicePixelRatio × viewportZoom` can improve clarity.
  - `T-037` and `T-038` documented that the first integration caused scroll regressions.
  - `T-040` documented a "safe" follow-up that deferred clarity updates until the terminal returned to the bottom, which protected behavior but created the wrong product outcome.
- `docs/TERMINAL_TUI_RENDERING_BASELINE.md`
  - Earlier overlay/portal and DOM-layer experiments caused hit-testing, focus, or drag regressions.

## 3. Why This Is Hard

This feature looks simple from the outside but is structurally tricky because four concerns overlap:

- Canvas zoom changes screen-space presentation.
- xterm owns its own renderer and backing raster.
- Terminal nodes are live interactive surfaces, not static images.
- Scroll and focus are stateful, not purely visual.

That combination means a "clarity refresh" can accidentally become:

- a layout refresh,
- a session refresh,
- a scroll reset,
- or a focus reset.

The root difficulty is not "how to make things sharper". The root difficulty is:

`how to trigger a sharper renderer pass without touching state owners that do not belong to clarity.`

## 4. Correct Problem Framing

The correct framing is:

`After viewport zoom settles, the renderer may increase backing density to match the final screen-space presentation, but this must not change terminal layout semantics, world-space semantics, or interaction semantics.`

Important translation:

- Raising backing density is allowed.
- Changing product zoom behavior is not allowed.
- Using screen-space zoom as an input to renderer oversampling is acceptable.
- Requiring the user to return to the bottom before the terminal can become sharp is not acceptable.

## 5. Product Constraints

These constraints are explicit and non-negotiable:

- Terminal and agent nodes must continue to follow the canvas visually.
- After zoom-in, they may continue to look larger on screen.
- This redesign must not make terminal windows or glyphs switch to a different size model.
- The optimization must not introduce a new click-to-reset-size behavior.
- The optimization must not alter the product's viewport zoom semantics.

## 6. State Owners

- `viewport zoom`
  - Owner: canvas / React Flow
  - Rule: unchanged
- Terminal node `world-space position / size`
  - Owner: existing node model
  - Rule: unchanged
- `clarity refresh`
  - Owner: new renderer-level controller
  - Rule: only controls timing and renderer refresh behavior
- `scroll state`
  - Owner: xterm buffer / viewport
  - Rule: must be preserved across clarity refresh
- `focus state`
  - Owner: live xterm instance + helper textarea
  - Rule: must be preserved across clarity refresh

## 7. Invariants

1. Canvas zoom semantics must remain unchanged.
2. The live terminal instance must not remount because of clarity refresh.
3. The terminal DOM ownership and layer topology must not change because of clarity refresh.
4. Clarity refresh must not depend on "terminal is at bottom".
5. Clarity refresh must not route through `fitAddon.fit()` or PTY resize.
6. User-scrolled state must survive the refresh.
7. Focus, selection, click, wheel, and IME behavior must survive the refresh.

## 8. Approach Options

### Option A: Commit-Only Clarity Refresh

Behavior:

- During an active zoom gesture, allow transient blur.
- After zoom settles, trigger exactly one renderer-level clarity refresh against the final transform.

Pros:

- Lowest risk to scroll/focus behavior.
- Matches the agreed requirement: `B required, A stretch`.
- Keeps the fix in the renderer boundary where it belongs.

Cons:

- Not continuously sharp during gesture.

### Option B: Throttled Progressive Refresh

Behavior:

- Refresh at a bounded cadence during zoom, then do a final settled refresh.

Pros:

- Closer to ideal continuous sharpness.

Cons:

- Higher risk of flicker, atlas churn, and scroll/focus regressions.
- Not appropriate as the first delivery target.

### Option C: Gesture Snapshot / Overlay Surrogate

Behavior:

- Freeze or mirror visual output during gesture, then swap back to live terminal afterward.

Pros:

- Can visually mask mid-gesture instability.

Cons:

- Wrong abstraction boundary.
- Risks double-truth behavior for focus, caret, selection, and hit-testing.

## 9. Recommended Design

Choose Option A for the required delivery.

Reasoning:

- It addresses the correct problem boundary: renderer re-rasterization after the final screen-space state is known.
- It preserves product semantics.
- It avoids bottom-gated refresh semantics.
- It keeps the first delivery focused on correctness and behavioral stability.

Stretch target:

- Option B may be explored later only after Option A is stable and well-covered by regression tests.

## 10. Design Mechanics

### 10.1 Zoom Lifecycle

Split zoom handling into two phases:

- `gesture active`
  - Do not perform heavy clarity refresh work.
  - Do not remount xterm.
  - Do not trigger `fitAddon.fit()`.
  - Do not trigger PTY resize.
- `gesture settled`
  - Wait for viewport transform to stabilize.
  - Use `requestAnimationFrame` sequencing to avoid refreshing against an intermediate layout.
  - Trigger one renderer-level clarity refresh commit.

### 10.2 Refresh Boundary

The clarity refresh must stay inside renderer concerns:

- update renderer oversampling / backing density for the final screen-space result,
- rebuild or redraw only what the renderer requires,
- avoid terminal lifecycle churn.

This refresh is allowed to use viewport zoom as an input to effective backing density.

This refresh is not allowed to:

- redefine node size semantics,
- redefine glyph size semantics,
- replace the live terminal instance,
- move terminal rendering into a different DOM truth.

### 10.3 Scroll / Focus Guard

Before clarity refresh:

- capture `viewportY`
- capture `isUserScrolling`
- capture focus state if needed for validation

After clarity refresh:

- validate the same terminal instance is still active
- restore or re-assert scroll state only if the renderer refresh disturbed it
- validate focus semantics are unchanged

This guard is defensive, not product behavior. It must not create a new rule like "only refresh when at bottom".

## 11. Rejected Framings and Rejected Approaches

Reject:

- "This is a CSS transform tuning problem."
  - It is not sufficient; CSS-only adjustments cannot create new backing pixels.
- "This is a scroll-ownership problem."
  - Scroll protection is required, but it is not the root fix.
- "Users in history should stay blurry until they return to bottom."
  - Wrong product semantics.
- "Portal / overlay / mirror rendering should solve this."
  - Wrong ownership boundary; too much interaction risk.
- "We can safely piggyback on fit/resize."
  - This mixes clarity with layout and PTY concerns.

## 12. Acceptance Criteria

- Terminal and agent nodes still follow existing zoom behavior visually.
- After zoom settles, terminals become sharp again.
- User-scrolled terminals also become sharp after zoom settles.
- No terminal remount occurs as part of the clarity refresh.
- No new click/focus behavior is introduced.
- Wheel scroll, selection, IME, and click behaviors remain unchanged.
- The implementation no longer depends on bottom-of-buffer heuristics for clarity eligibility.

## 13. Verification Plan

### Unit

- zoom-settled detection
- controller only commits after settled state
- user-scrolled terminals remain eligible for refresh

### Integration

- refresh preserves `viewportY`
- refresh preserves `isUserScrolling`
- refresh preserves terminal instance identity

### E2E

- zoom-in followed by settled refresh produces sharp render metrics
- user-scrolled terminal also sharpens after settle
- focus/click/selection behavior stays intact
- regression test proving "only bottom becomes sharp" is gone

## 14. Risks and Trade-offs

- Option A intentionally trades perfect mid-gesture sharpness for behavioral stability.
- The design still depends on xterm renderer internals, so upstream version changes may require refresh-path adjustments.
- The design should avoid scope creep into zoom semantics, layout semantics, or node topology changes.

## 15. Spec Conclusion

The safe redesign is:

- keep existing zoom behavior,
- treat clarity as a renderer-only re-rasterization concern,
- trigger a single clarity refresh after zoom settles,
- preserve scroll/focus state across that refresh,
- and explicitly reject bottom-gated or overlay-based fixes as the primary path.
