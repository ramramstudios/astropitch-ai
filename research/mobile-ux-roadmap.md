# Mobile UX roadmap

Working doc for the branch aimed at making mobile mode a genuinely good phone
experience, not just a scaled-down desktop layout. Written before touching
code, so the standards below can be checked against as changes land.

This is a roadmap of *standards*, not a sprint plan — each section is a bar to
clear, not a ticket. Turn items into actual to-dos once we agree on scope.

> Revised 2026-08-28: every repo claim below re-checked against `src/ui/app.js`,
> `src/ui/wheel.js`, `src/styles.css`, `index.html`, and `tests/mobile.test.mjs`
> at commit `a81fc9e`; the external UX claims re-sourced to primary guidance
> (see Sources). Corrections are marked **[was wrong]** / **[sharpened]** so the
> earlier version's assumptions aren't silently inherited.

## Where mobile mode stands today

For grounding, what already exists:

- A `data-mode` split (`MODE_QUERY = '(max-width: 760px), (pointer: coarse)'`,
  app.js:81) auto-switches layout; a Settings toggle overrides it and, once
  used, stops auto-detection from moving it (`wireLayoutMode`, app.js:1678).
- The desktop side panel becomes a draggable bottom sheet with three snap
  states (`peek` / `half` / `full`, app.js:1714), a drag handle, and
  **nearest-height** snapping. **[was wrong]** The earlier draft called this
  "momentum-based". It isn't: `nearestSheetState` (app.js:1722) picks the snap
  height with the smallest absolute distance and there is no velocity term
  anywhere in `wireSheet`. A tap under 4px of travel instead cycles states via
  `nextSheetState` (app.js:1717).
- **[was wrong]** The sheet does *not* inherit a desktop-left-behind state. It
  seeds from `localStorage['astropitch.sheetState']` (`SHEET_KEY`, app.js:82)
  and falls back to `'half'` (app.js:1739); the drag/tap handlers early-return
  unless `mode === 'mobile'`, so desktop never writes that key. The open
  question in §2 is therefore settled: **the default is `half`, and thereafter
  the last mobile state.**
- **Five tabs** live in that sheet: Chart, Placements, Aspects, Overlay,
  Sound (index.html:77-81) — the full desktop control surface, reused as-is.
  **[sharpened]** `peek` is not transport-only: `recomputeHeights` sets it to
  `max(56, handleH + tabsH)` (app.js:1751), so the collapsed sheet already
  renders the entire five-tab strip.
- The chart wheel supports pinch-zoom and pan. **[sharpened]** Both are
  mobile-only — `setInteractionMode` (wheel.js:165) resets the view on
  desktop — scale is clamped to 1×–4× (`VIEW_MIN_SCALE`/`VIEW_MAX_SCALE`,
  wheel.js:35-36), and pan is clamped so content edges can't cross the
  container's (`clampPanView`, wheel.js:56).
- No onboarding/walkthrough exists on either platform — confirmed, nothing
  matching `onboard`/`tour`/`coachmark`/first-run exists in `src/`. The
  closest thing is the **How it works** modal (`#aboutBtn`, index.html:62),
  which is re-enterable, closes on `Esc`, and returns focus to its opener
  (app.js:1543-1552).
- **[added]** Two of the bars below are already partly met, and the checklist
  should treat them as verification rather than construction: `viewport-fit=cover`
  plus a dozen `env(safe-area-inset-*)` uses across styles.css, and
  `touch-action: none` on `.wheel-svg.is-zoomable` (styles.css:2067) — the
  deliberate system-gesture exception §1 hypothesises is already implemented
  and commented.

The user's own framing for this branch: *"a clean screen without crowded
tabs/obstructions/controls, and a clear objective"* — plus a possible
walkthrough. The five-tab sheet reusing the entire desktop surface is the
most obvious mismatch with that goal: it's comprehensive, not focused. That
the tab strip is also *visible at `peek`* makes the mismatch worse than the
earlier draft assumed.

## 1. Objective standards for a good mobile web-app experience

These are the industry-standard bars (iOS HIG, Android Material, WCAG, and
2026 mobile UX practice) that any mobile web app should clear. Sourced from
current guidance, linked at the bottom.

### Touch and reachability

- **Platform minimum touch target: 44×44pt (iOS HIG) / 48×48dp (Material 3).**
  **[sharpened]** These are design guidance grounded in finger-pad size
  (~9mm), not a measured error cliff at exactly 44pt. The earlier draft's
  "measured tap-error rates rise sharply — smaller targets are a correctness
  bug" overstates the evidence; the widely-quoted "60–80% fewer mis-taps"
  figures come from vendor blogs, not a controlled study. Treat 44/48 as the
  bar to clear because the platforms say so, which is reason enough.
- **[was wrong] WCAG is a *weaker* bar than the platforms, not the same one.**
  The earlier draft folded target size into "Accessible contrast and target
  sizing (WCAG). Same targets as above." It isn't the same target: WCAG 2.2
  **SC 2.5.8 Target Size (Minimum), Level AA is 24×24 CSS px** and carries a
  spacing exception; **44×44 is SC 2.5.5 Target Size (Enhanced), Level AAA**,
  which has no spacing escape hatch. Clearing 44pt clears both; claiming
  "WCAG requires 44" in a PR description would be wrong.
- **Thumb zone.** **[sharpened]** Hoober's map (≈1,333 observations; ~49%
  one-handed grip) puts the comfortable green zone at the **bottom-centre**,
  not the "bottom two-thirds" the earlier draft claimed — mid-screen sides are
  already a stretch. The top corners as worst-case is correct and is the part
  that bites this app.
- **Spacing between targets**, not just target size — adjacent small hit
  areas still mis-tap even if each individually clears 44pt. (This is also
  the mechanism behind SC 2.5.8's spacing exception.)

### Screen focus and information density

- **One primary objective per screen.** A mobile screen should make it
  obvious what the user is meant to do *right now*, not present the full
  option set desktop affords.
- **Progressive disclosure over simultaneous display.** Secondary controls
  (advanced chart inputs, palette tuning, overlay setup) should be reachable,
  not resident on-screen by default competing with the primary view. NN/g's
  original formulation is the useful one: show the few things most users need
  most of the time, one level deep, with a clear way to the rest.
- **Avoid tab-bar overcrowding.** **[sharpened]** The earlier draft's "caps
  around 4–5" was vague in the app's favour. Both platforms say **3–5**:
  Apple HIG recommends three to five tabs on iPhone, and Material 3 says a
  navigation bar holds three to five destinations and that products with more
  should not use one at all. **Five tabs sits exactly on the ceiling of both
  specs, not comfortably inside them** — and every tab is competing for
  attention on a screen that's mostly there to *show the chart*.

### Onboarding

- **[was wrong] The retention statistic was misattributed.** The earlier
  draft said "industry benchmarks cite single-digit percent completion over 30
  days" for *onboarding completion*. The single-digit figure is **Day-30
  retention**, not onboarding completion: median ≈4% across categories,
  ≈5–8% at the 75th percentile, Adjust's cross-app average ≈6%. No
  comparable public benchmark exists for onboarding-completion-at-30-days.
- **Reach a real result in the first session.** **[sharpened]** The "~60
  seconds" figure has no primary source behind it. What is supported: apps
  that get a user to a core value action *within the first session* see
  materially better Day-7 retention. Use "first session", not a stopwatch
  number, as the bar.
- **Progressive/contextual over a static front-loaded tour.** Teaching a
  feature the moment it's first relevant (a tooltip on first pinch, a hint
  the first time the sheet opens) beats a multi-screen walkthrough nobody
  reads before the app itself. Keep hints visually unmistakable as
  annotations — a coachmark styled like a button gets tapped like one.
- **Always re-enterable.** Whatever guidance is shown once must have a
  permanent way back in (a "?" in Settings, e.g.) rather than being a
  one-time modal the user can't recall on purpose.
- **Keep it short if a tour is used at all.** Under 5 screens; each screen
  should teach exactly one thing.

### Platform conventions

- **Respect safe areas** — notch, Dynamic Island, home indicator — content
  must never be obscured by system chrome, and this must hold in both
  orientations if both are supported.
- **Respect system gestures.** The system back-swipe / OS-level gestures
  should not be fought or intercepted by app-level pan gestures without a
  clear reason. **[added]** This app already takes that exception knowingly
  and narrowly: `touch-action` is `none` only on `.wheel-svg.is-zoomable`,
  and `pinch-zoom` on the designer surface when not zoomable (styles.css:2066-2067),
  with a comment explaining that browser page-zoom would otherwise fight the
  JS-driven one.
- **Performance is UX.** Slow first paint, jank during pinch/pan, or a
  render stutter on chart change reads as broken, not just slow — this
  project already treats stutter as a defect (`tests/stability.test.html`,
  the census work in `outstanding.md`), so this is really about extending
  that standard to the *mobile* rendering path (60fps pinch/pan, no layout
  thrash on sheet drag) specifically, since the census work covered audio,
  not touch rendering.
- **Accessible contrast (WCAG).** SC 1.4.3 (4.5:1 for body text, 3:1 for
  large) and SC 1.4.11 (3:1 for UI component boundaries) — worth checking
  once since this app already has a light/dark theme story.

## 2. What "clean and uncrowded" means for *this* app specifically

Generic advice above, applied to AstroPitch's actual shape:

- **The wheel is the objective.** Everything else — chart entry, palette
  choice, overlay setup — is in service of "hear this chart." The clear
  objective the user wants is arguably already implicit in the product; the
  job is to stop the five-tab sheet from competing with it by default.
- **Candidate simplification:** default the mobile sheet to `peek` showing
  only the transport and nothing else. **[updated]** Two facts change this
  from a guess into a scoped change: the current default is `'half'`
  (app.js:1739), and `peek` currently *includes* the tab strip because its
  height is `handleH + tabsH` (app.js:1751). So "peek shows only the
  transport" means changing the fallback state *and* hiding `.tabs` at peek —
  and then reconsidering `expandSheetIfPeeking` (app.js:1779), which exists
  precisely because a tab tapped at peek would otherwise reveal nothing.
- **Candidate simplification:** on first mobile visit, is there a natural
  "first meaningful win"? E.g., a default/sample chart already sounding
  within the first interaction, with chart *input* as the thing you're
  invited into next rather than the first gate.
- **Tabs are a design smell worth re-examining on mobile specifically**,
  even though they're fine on desktop where screen real estate isn't scarce.
  **[updated]** With Apple and Material both at 3–5, five is the ceiling
  rather than a comfortable number. Options to weigh once this branch is
  scoped: collapse rarely-used tabs (Overlay, Sound) behind a single "More,"
  or make the sheet itself context-sensitive (only show Placements/Aspects
  once a chart exists).

## 3. Walkthrough / guided tour — recommendation

Given the practices above and this app's own complexity (designer drags,
four playback modes, temperament/palette choices), a **progressive,
contextual** approach fits better than a static multi-screen tour:

- A first-run hint tied to the *first* pinch/pan ("pinch to zoom the wheel")
  rather than a modal wall before the user has touched anything.
- A first-run hint the first time the sheet is dragged, if the drag
  interaction isn't self-evident from the handle alone. Worth noting the
  handle already has a second affordance the hint could name instead: a tap
  cycles peek → half → full (`nextSheetState`, app.js:1717).
- The existing **How it works** modal already covers the conceptual model
  (astrology → sound) — that's the right home for anything that needs more
  than a one-line hint, and it's already re-enterable. A new tour shouldn't
  duplicate it; it should link to it.
- Skip a numbered front-loaded tour unless testing shows people are actually
  lost — it's the pattern most likely to be dismissed unread on a screen
  this focused around one direct-manipulation object (the wheel).

## 4. Proposed checklist (fill in / reorder once scoped)

- [ ] **Decide the default mobile sheet state and what's visible in it**
  - `wireSheet()` (app.js:1738) seeds `state` from `localStorage['astropitch.sheetState']`
    and falls back to `'half'`; changing the default is a one-line change there,
    plus a decision about whether a persisted old value should be honoured.
  - `recomputeHeights()` (app.js:1751) derives `peek` from `handleH + tabsH`, so a
    transport-only peek needs `.tabs` hidden at peek in styles.css (the `html[data-mode="mobile"] .side`
    block, styles.css:816) *and* that height formula changed to drop `tabsH`.
  - `expandSheetIfPeeking()` (app.js:1779), called from `select()` (app.js:769), auto-promotes
    peek → half on any tab tap; whatever the new default is must keep that path or tapping a
    tab lands on an empty sheet.

- [ ] **Audit all mobile touch targets against 44×44pt / 48dp**
  - Known failures to fix first: `.volume-toggle` is `2.5rem` = 40px on mobile
    (styles.css:1476), and `.chart-help` gets `padding: 1.1rem 0.1rem` (styles.css:162) — the
    vertical clears 44px but the horizontal hit area is text-width plus 3.2px.
  - Already passing — don't re-litigate these: `button.primary`/`button.ghost`
    `min-height: 44px` (styles.css:1104-1105), `.time-stepper button { height: 2.75rem }`
    (styles.css:975), `.transport-main { min-height: 46px }` (styles.css:1908), and
    `button.play { min-height: 46px }` (styles.css:1937).
  - `tests/mobile.test.mjs` has no DOM, so this can't be asserted directly; the existing
    precedent for touching CSS from that suite is the `cssSrc.includes('#' + modeButtonId(mode))`
    check, so either add regex assertions over `styles.css` or record this as manual QA.

- [ ] **Audit thumb-zone placement of play/stop and mode switch**
  - Already in the green zone: `#transportModes` and `button.play` sit in
    `<footer class="transport">` (index.html:322-326), built from `MODES` by
    `buildTransportModes()` (app.js:1360) into a 6-column grid (styles.css:1910).
  - In the red zone: `.wheel-actions` (index.html:60-64) puts Full-screen, Settings, and
    How it works in the top-right of `.wheel-kicker` — each needs a grip change to reach.
  - `#sheetHandle` (index.html:73) is the one bottom-edge control competing with the OS
    home-indicator swipe; check its hit area against `--sheet-bottom` (styles.css:109).

- [ ] **Decide whether all five tabs stay equally prominent, or some collapse/hide contextually**
  - The five `role="tab"` buttons are hand-written at index.html:77-81 and paired with five
    `.tabpanel` sections (index.html:84, 188, 202, 216, 285); collapsing any means editing both
    lists plus the `aria-controls`/`aria-labelledby` wiring.
  - `select()` (app.js:766) already sets the contextual precedent — it drops the overlay merge
    when the Overlay tab loses focus — but `state.activeTab` persists to `ACTIVE_TAB_KEY` and is
    restored pre-paint by the index.html bootstrap (index.html:28-29), so hiding a tab must
    handle "the persisted tab no longer exists".
  - `recomputeHeights()` measures the live `.tabs` height, so any change to the strip silently
    moves the `peek` snap point — update the `nearestSheetState` cases in
    tests/mobile.test.mjs:104-111, which currently hardcode `peek: 76`.

- [ ] **Add first-run contextual hints (pinch/pan, sheet drag) — not a static tour**
  - Nothing exists to extend: no first-run flag anywhere in `src/`, and the only `hint`
    elements are `.readout-hint` (app.js:2560) and the two Overlay `.note` placeholders
    (app.js:2331, 2341) — both are `replaceChildren` swaps, a usable pattern to copy.
  - The trigger points already have handlers: first pinch is the two-pointer branch reached
    from `_onViewPointerDown` (wheel.js:138 → wheel.js:253); first sheet drag is the
    `drag.moved` flip in the handle's `pointermove` (app.js:1801).
  - Persist "seen" through the existing `stored()` helper (app.js:1826) alongside `SHEET_KEY`
    / `MODE_KEY` / `ACTIVE_TAB_KEY` so it inherits the try/catch fallback, and have re-entry
    open `#aboutBtn`'s modal rather than restating it.

- [ ] **Confirm safe-area handling (notch/Dynamic Island/home indicator) in both orientations**
  - Largely built already — `viewport-fit=cover` (index.html:5) plus `env(safe-area-inset-*)`
    at styles.css:50, 55, 104, 109, 181-183, 307, 315, 1319-1321, 1726 and 2195-2198 — so scope
    this as verification, not construction.
  - Landscape is the actual gap: only styles.css:181-183 and 1320-1321 use the left/right
    insets, and `html[data-mode="mobile"] .side` (styles.css:816) is `left: 0; right: 0` with
    no inset padding, so a landscape notch overlaps the sheet's edges.
  - `--transport-total-h` (styles.css:50) folds `safe-area-inset-bottom` into the height
    `availableHeight()` subtracts (app.js:1743) — verify the `half`/`full` snap heights on a
    real home-indicator device, not a simulator without one.

- [ ] **Re-measure mobile pinch/pan render performance (no jank standard, analogous to the audio stability work)**
  - Asymmetry to fix or justify: `wheel._setView` coalesces writes into one
    `requestAnimationFrame` (wheel.js:191-196), but the sheet drag writes `sheet.style.height`
    on every `pointermove` with no rAF gate (app.js:1805).
  - `html[data-mode="mobile"] .side` animates `transition: height 220ms ease` (styles.css:832) —
    a layout-triggering property. `.is-sheet-dragging` (styles.css:833) suppresses it mid-drag but
    not on the snap-back, which is the frame budget worth tracing.
  - There's no harness for this: tests/mobile.test.mjs is pure math and `tests/run-browser.mjs`
    drives audio pages against a null sink, so decide in the to-do whether this becomes a new
    browser page or is logged as DevTools-trace manual QA.

- [ ] **Confirm dark/light contrast holds against WCAG on mobile-specific surfaces (sheet, tabs)**
  - Highest-risk pair: `.tab` is `var(--graphite)` at `0.61rem` uppercase (styles.css:722-726)
    over `--panel-solid`, and `--graphite` is `#545454` light / `#c4c4c0` dark (styles.css:5, 65) —
    small text, so SC 1.4.3 wants 4.5:1.
  - Mobile shrinks the same colour further: `.chart-help` and `.wheel-kicker` both drop to
    `0.56rem` (styles.css:162, 1892), so they are the same check at a worse size.
  - Check the sheet's own boundary under SC 1.4.11: `border-top: 1px solid var(--ink)` plus
    `box-shadow: 0 -10px 28px rgba(0,0,0,0.18)` (styles.css:827-829) is the only separation
    between sheet and wheel, and the shadow does nothing in dark mode.

- [ ] **Decide "first meaningful win" for a fresh mobile visitor — sample chart on load? clearer call-to-action into chart input?**
  - First establish what a cold load actually shows: Chart is `is-active` in markup
    (index.html:77) and the bootstrap restores `activeTab` pre-paint (index.html:28-29) — confirm
    whether the wheel arrives populated or empty before designing around it.
  - Cheapest win is one tap on an already-populated wheel: `DEFAULT_MODE_ID` is `'bloom'`
    (modes.js:583) and `button.play` is already in the thumb zone, so seeding a sample chart
    makes play-on-arrival work with no new UI at all.
  - Whatever is chosen must survive `_resetView()` (wheel.js:171) and the mode flip in
    `applyMode()` (app.js:1681) — a first-run state that only exists in mobile mode disappears
    the moment someone uses the Settings layout switch.

## Sources

Primary guidance (use these in PR descriptions):

- [Apple HIG — Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars) (three to five tabs on iPhone)
- [Apple HIG — Layout](https://developer.apple.com/design/human-interface-guidelines/layout) (44×44pt minimum tap target)
- [Material 3 — Navigation bar guidelines](https://m3.material.io/components/navigation-bar/guidelines) (three to five destinations; don't use one above five)
- [Material 3 — Accessibility](https://m3.material.io/foundations/overview) (48×48dp touch target)
- [WCAG 2.2 — SC 2.5.8 Target Size (Minimum), AA](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) (24×24 CSS px)
- [WCAG 2.2 — SC 2.5.5 Target Size (Enhanced), AAA](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html) (44×44 CSS px)
- [WCAG — SC 1.4.3 Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) · [SC 1.4.11 Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
- [NN/g — Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
- [Steven Hoober's thumb-zone research, via Smashing Magazine](https://www.smashingmagazine.com/2016/09/the-thumb-zone-designing-for-mobile-users/) · [LukeW on large-screen reach](https://www.lukew.com/ff/entry.asp?1927=)

Secondary / benchmark (treat as directional, not authoritative):

- [Appcues — app retention benchmarks](https://www.appcues.com/blog/app-retention-is-hard-heres-how-to-improve-it) (Day-30 retention, the figure the earlier draft misread as onboarding completion)
- [Userpilot — mobile app retention](https://userpilot.com/blog/mobile-app-retention/)

Dropped from the earlier draft: the Taboola, Medium, edesignify, Eleken, VWO,
scandiweb, djEnterprises, and Brilworks links. They are SEO round-ups that
restate the primary sources above without adding evidence, and two of the
claims they were cited for (44pt as a WCAG requirement, single-digit
onboarding completion) turned out to be wrong.
