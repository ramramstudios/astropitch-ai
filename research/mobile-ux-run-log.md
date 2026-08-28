# Mobile UX roadmap — run log

Companion log for `research/mobile-ux-roadmap.md` §4, on branch
`mobile-view-improvements-for-iOS`. Updated as each checklist item lands.

Follows the convention in `outstanding.md`: **Completed** is what actually
changed and was checked; **Waived** is a check the item called for that this
run did not complete, with why.

One extra section this log needs that `outstanding.md` does not:
**Needs manual QA on device**. This session has no phone, no simulator, and no
visual check. `CLAUDE.md` is explicit that mobile CSS/layout behaviour, real
pointer/touch event wiring, and the service-worker/offline path are *not*
covered by the test suite, and `tests/mobile.test.mjs` is pure math with no
DOM. **Every CSS change below is unverified until someone looks at a phone.**
Nothing in this log should be read as "confirmed working on a device".

## Scope of this run

Ship, because they are objective and checkable without a device:
items **2** (touch targets), **6** (safe areas), **7** (pinch/pan perf),
**8** (contrast).

Analyse and recommend only, because they change the product's shape and the
owner wants those calls himself: items **1**, **3**, **4**, **5**, **9**.
For those, the deliverable is a written recommendation with the diff that
would be made and the tradeoff — not the redesign.

## Test baseline

At `af55dfb`, reproduced at the start of this run:

| suite | pass |
| --- | --- |
| engine | 50 |
| ephemeris | 25 |
| mobile | 101 |
| palettes | 23 |
| performer | 87 |
| synastry | 38 |
| ui-state | 10 |
| ota | 0 (no `PASS` lines; exits 0) |

Known red, deliberately untouched: `tests/designer.test.mjs` at 55 pass / 2
fail — "drops out of the elemental balance", "drops out of the modal
balance". Pre-existing, chart-math not layout, unrelated to this branch. It
is left exactly as it is and is **not** counted as a regression.

Run with `for f in tests/*.test.mjs; do node "$f"; done` (no `package.json`;
node is invoked directly).

---

## Item 2 — Audit mobile touch targets against 44x44pt / 48dp — **done**

**Completed**

- `.volume-toggle` was `2.5rem` (40px) on mobile because the `.volume` row it
  sits in was 42px tall (`src/styles.css`). Raised the row to 44px and the
  toggle to `2.75rem` (44px). The transport's budget absorbs it: mobile
  `--transport-h` is 100px against `.transport-main`'s 46px `min-height` plus
  this row's 44px = 90px. `box-sizing: border-box` is global, so
  `.transport`'s `height: var(--transport-total-h)` leaves the full 100px of
  content box.
- `.chart-help` (Full-screen / Settings / How it works, `index.html:60-62`)
  had `padding: 1.1rem 0.1rem` on mobile. The vertical already cleared 44px;
  the horizontal hit area was just however wide the label's glyphs rendered,
  plus 3.2px. Added `min-width: 44px` and `min-height: 44px`, and widened
  side padding to `0.35rem`. `min-width` matters twice here: it sets the
  floor for a short label, and it stops these flex children shrinking below
  44px when the kicker row runs out of width.
- Paid for that width instead of taking it off the chart label: added
  `html[data-mode="mobile"] .wheel-actions { gap: 0.5rem }`. Separation
  between two adjacent buttons is unchanged at 19.2px (was
  `0.1rem + 1rem + 0.1rem`, now `0.35rem + 0.5rem + 0.35rem`) — the dead
  space simply moved inside the tap targets. Net row growth is 8px rather
  than the 24px that growing padding alone would have cost `.chart-label`,
  which ellipsises.
- Added a `mobile touch targets clear 44x44pt` block to
  `tests/mobile.test.mjs` (10 new assertions, 101 → 111). It parses the
  declarations out of `styles.css` — last matching rule wins — converts
  `rem`/`px` to px, and asserts each target `>= 44`, that the `.volume` row
  is at least as tall as its toggle, and that adjacent `.chart-help` targets
  keep >= 16px of separation. The precedent for reading `styles.css` from
  this suite is the existing `cssSrc.includes('#' + modeButtonId(mode))`
  check.
- Negative-tested the new assertions: reverting `.volume-toggle` to `2.5rem`
  turns them red with `— 40px`, so they are not vacuous.

**Standard applied:** iOS HIG 44x44pt, which also clears WCAG 2.2 SC 2.5.5
(Enhanced, AAA). Not Material's 48dp — the roadmap's own framing is
iOS-first, and the branch is `mobile-view-improvements-for-iOS`. WCAG's
actual AA bar, SC 2.5.8, is 24x24 CSS px and is cleared with room to spare;
this run does not claim 44 is a WCAG AA requirement.

**Not re-litigated** (roadmap says they already pass, and they still read
that way in the file): `button.primary` / `button.ghost` `min-height: 44px`,
`.time-stepper button { height: 2.75rem }`, `.transport-main
{ min-height: 46px }`, `button.play { min-height: 46px }`.

**Waived**

- A real sweep of *every* mobile control. This fixed the two known failures
  the roadmap named and added a regression net around them. A full audit
  needs a DOM to enumerate rendered controls and measure them; the static
  parser can only check rules that declare an explicit size.
- Browser suites (`tests/run-browser.mjs`). Not run for this item — see
  "Browser suites" at the foot of this log.

**Needs manual QA on device**

- The mobile transport at 44px: that `.transport-main` 46px + `.volume` 44px
  really do fit the 100px `--transport-h` without clipping the volume slider
  or the mode row, on a real iPhone with a home indicator.
- The `.wheel-kicker` row at its new widths: whether `.chart-label`
  ellipsises earlier than is acceptable on a 375px-wide screen with a long
  chart name, and whether the three actions still fit without wrapping.
- Whether the wider `.chart-help` underline (`border-bottom` now spans
  `text + 0.7rem`) still reads as a link rather than a box.
- That the enlarged `.volume-toggle` hit area does not overlap the volume
  slider's thumb at the left end of its travel.

---

## Item 6 — Confirm safe-area handling in both orientations — **done**

Scoped as verification plus the two gaps the roadmap named, not construction:
`viewport-fit=cover` and a dozen `env(safe-area-inset-*)` uses were already
in place.

**Completed**

- **Landscape gap closed.** `html[data-mode="mobile"] .side` was
  `left: 0; right: 0` with no inset padding, so in landscape on a notched
  iPhone the notch and the rounded display corners sat over the sheet's tab
  strip and panel content. Added
  `padding-left: env(safe-area-inset-left)` / `padding-right:
  env(safe-area-inset-right)`.
  Chose padding over inset `left`/`right` offsets deliberately: the box, top
  border, radius and shadow still reach the screen edges — an inset position
  would let the wheel show through in the strip beside the sheet — and only
  the controls move in. That is Apple's own edge-to-edge-background /
  inset-content split. Both terms are 0 on a device with no physical safe
  area, so nothing changes on hardware without one.
- **`availableHeight()` now tracks the visual viewport.** Added a pure,
  exported `sheetViewportHeight(innerHeight, visualViewport)` in `app.js` and
  wired `wireSheet`'s `availableHeight()` to it, plus a
  `window.visualViewport.addEventListener('resize', ...)` alongside the
  existing `window` resize. iOS Safari reports the *large* viewport from
  `window.innerHeight` whether or not the URL bar is expanded, and collapsing
  the bar fires no window `resize`, so `half`/`full` overshot by the height
  of the bar and put the top of the sheet under browser chrome.
  `starfield.js` already listened to `visualViewport` for the same reason;
  this removes that asymmetry.
- Two corrections inside that helper, both asserted:
  - Page pinch-zoom divides `visualViewport.height` by the zoom scale;
    multiplying back by `scale` (then clamping to `innerHeight`) stops a
    zoomed page collapsing the sheet to a fraction of the screen.
  - The on-screen keyboard shrinks the visual viewport too, by far more than
    any URL bar. The Chart tab has text inputs, so resizing the sheet out
    from under someone who has just focused a field would be worse than the
    overshoot being fixed. A visual viewport under `SHEET_KEYBOARD_RATIO`
    (0.7) of the layout height is treated as a keyboard and ignored. iOS
    Safari's URL bar plus toolbar is ~15% of a phone screen and the keyboard
    is 40-50%, so one constant separates the cases without detecting the
    keyboard directly.
  - Subscribed to `visualViewport` `resize` only, not `scroll`. starfield.js
    takes `scroll` too because it tracks a *position*; the sheet only needs a
    height, and re-writing `sheet.style.height` every scroll frame is exactly
    the layout thrash item 7 is about.
- **Bottom inset fixed as a side effect.** `availableHeight()` subtracted
  `--transport-h`, which excludes the home-indicator inset, and carried its
  own `is-transport-hidden` branch duplicating a rule `styles.css` already
  has. It now reads `getComputedStyle(sheet).bottom` — the used value of
  `bottom: var(--sheet-bottom)`, already resolved to px, and already correct
  in both transport states (`--transport-total-h` when showing,
  `env(safe-area-inset-bottom)` when hidden). Note
  `getPropertyValue('--sheet-bottom')` would *not* work: an unregistered
  custom property computes to its unresolved `calc(... + env(...))` token
  stream, not a length. Net effect on a home-indicator device: the snap
  heights stop being ~34px too generous, and one duplicated rule is gone.
- 18 new assertions in `tests/mobile.test.mjs` (111 -> 129): the
  `sheetViewportHeight` table (URL bar, pinch-zoom, keyboard, missing
  `visualViewport`, zero height), that `app.js` actually subscribes to
  `visualViewport` resize and no longer re-derives `--transport-h`, and that
  the sheet rule carries both horizontal insets while staying `left: 0 /
  right: 0`.

**Finding, not fixed — needs an owner decision**

`wireTransportVisibility()`'s `apply()` (`app.js`) toggles
`is-transport-hidden`, which moves `--sheet-bottom` in CSS, but nothing calls
the sheet's `recomputeHeights()`. So hiding or showing the transport moves
the sheet's bottom edge without updating its `peek`/`half`/`full` snap
heights until the next resize. This predates the run and is *not* made worse
by the change above — in fact the new `getComputedStyle(sheet).bottom` read
means the next recompute now picks up the right value automatically. Fixing
it is a one-line hook (export a `refreshSheetHeights` next to `setSheetMode`
and call it from `apply`), but it changes behaviour — the sheet visibly
resizes when you hide the transport — and there is no device here to judge
whether that reads as correct or as a glitch. Left for the owner.

**Waived**

- Verifying the actual inset values. `env(safe-area-inset-*)` resolves only
  in a real browser on real hardware; the tests assert that the declarations
  exist and are wired to the right variables, which is the most a
  DOM-less suite can do.
- Simulator checks. The roadmap's own bullet says to verify `half`/`full` on
  a real home-indicator device rather than a simulator without one, and
  neither is available here.
- Browser suites — see "Browser suites" at the foot of this log.

**Needs manual QA on device**

- Landscape on a notched iPhone, both rotations: the sheet's tab strip and
  panel content clear of the notch and the rounded corners, and the sheet
  background still reaching both screen edges with no strip of wheel showing
  beside it.
- Portrait: scrolling to collapse the URL bar and back, checking the sheet's
  `full` snap now lands under the chrome rather than behind it, and that the
  220ms height transition on each visualViewport resize reads as intentional
  rather than as a wobble.
- Focusing a Chart-tab text field: confirming the sheet does *not* resize
  when the keyboard opens (the 0.7 ratio doing its job), and that 0.7 is on
  the right side of the real numbers for the devices that matter.
- Pinch-zooming the page itself (not the wheel, which has
  `touch-action: none`) and confirming the sheet keeps its size.
- The `full` snap on a home-indicator device now that the bottom inset is
  subtracted: it should sit ~34px higher than before.

---

## Item 7 — Re-measure mobile pinch/pan render performance — **partly done**

The roadmap's first bullet is fixed; the second is documented as an accepted
cost with the reasoning below; the third (a harness) is waived.

**Completed — the asymmetry the roadmap named**

`wheel._setView` coalesced its writes into one `requestAnimationFrame`
(`wheel.js`), but the sheet drag wrote `sheet.style.height` on every
`pointermove` with no gate (`app.js`). That is backwards: a pointermove can
fire several times per animation frame, and the sheet writes `height` — a
**layout**-triggering property on the subtree holding the entire five-tab
control surface — where the wheel writes `transform`, which the compositor
can take. The gated one was the cheap one.

- The drag now uses the same leading-edge pattern `_setView` uses: the height
  is recorded synchronously, the DOM write is coalesced to once per frame,
  and the frame that runs uses the latest value rather than the one that
  scheduled it.
- `endDrag` now snaps from the height the drag last recorded rather than
  `sheet.getBoundingClientRect().height`. With the write coalesced, that rect
  can be a frame behind the gesture, and cancelling the pending frame would
  freeze it there. The pending frame is cancelled rather than flushed —
  `apply()` sets the snap height immediately afterwards, so flushing would
  only paint an intermediate value.
- Extracted the clamp as an exported pure `clampSheetHeight(heights,
  startHeight, dy)`, matching the existing `nextSheetState` /
  `nearestSheetState` precedent, so the drag arithmetic is testable without
  a DOM.
- 16 new assertions (129 -> 145): the clamp table, that the clamped value
  feeds `nearestSheetState` correctly at each snap, that `wheel.js` still
  coalesces, that the sheet now schedules on a frame and skips scheduling
  when one is pending, that `pointermove` no longer writes `style.height`
  directly, and that the drag-suppression class and its CSS rule stay
  paired. Negative-tested: putting the direct write back turns it red.

**Documented, not changed — the 220ms height transition**

`html[data-mode="mobile"] .side` animates `transition: height 220ms ease`.
`height` is layout-triggering, and `.is-sheet-dragging` suppresses it during
the drag but not on the snap-back, so the snap-back is ~13 frames of layout
on that subtree. Keeping it, for three reasons:

1. It is a one-shot 220ms transition at the *end* of a gesture, not a
   per-frame cost during one. The thing that actually reads as jank — layout
   thrash while your finger is moving — is what the rAF gate above addresses,
   and the drag already runs with the transition off.
2. The obvious alternative, animating `transform: translateY` on a
   full-height sheet, is not a like-for-like swap. The sheet is
   `overflow: hidden` with a `.tabpanel` that scrolls inside whatever height
   it currently has; making it always full-height and translated down changes
   what the panel's scroll area is, where it clips, and what the handle's
   `getBoundingClientRect` returns during a drag. That is a redesign of the
   sheet's geometry, not a perf tweak, and it is not verifiable here.
3. `contain: layout paint` on `.side` would be the cheap middle option and
   would confine the relayout to the sheet's subtree. Not applied: `contain`
   makes the element a containing block for absolutely and fixed-positioned
   descendants, `styles.css` has fourteen `position: absolute/fixed` rules,
   and establishing which of them resolve against something outside `.side`
   needs a rendered DOM. Shipping it blind could silently reposition a
   control. **Recommended as a follow-up once someone has a device** — it is
   a one-line change with a real payoff, but it needs to be looked at.

**Waived**

- Any actual measurement. There are no numbers in this entry, and none should
  be inferred from it. `tests/mobile.test.mjs` is pure math and
  `tests/run-browser.mjs` drives audio pages against a null sink; neither can
  observe a dropped frame during a touch gesture. The roadmap's third bullet
  asks for a decision on whether this becomes a browser page or manual QA:
  **the recommendation is manual QA via a DevTools performance trace over
  USB**, not a new page. A headless Chrome with no compositor under load and
  no touch digitiser cannot reproduce the condition being measured, so a page
  would produce numbers that look authoritative and mean nothing — the
  opposite of what the audio stability work did, where the null sink still
  let the audio thread be measured honestly.
- Any claim that the change is faster. The rAF gate is correct by
  construction (fewer forced layouts per frame cannot be slower), but "no
  jank" is a measurement, and this run did not make one.

**Needs manual QA on device**

- A DevTools performance trace of a sheet drag on a real phone: forced
  reflows per frame during the drag, and the frame budget of the snap-back
  transition. This is the item's actual acceptance check and it has not been
  done.
- That the drag still tracks the finger with the write coalesced — one frame
  of latency should be invisible, but that is an assumption until someone
  drags it.
- That the tap-to-cycle path (under 4px of travel) is unaffected: the
  recorded height now seeds from `startHeight` at pointerdown, so a tap that
  never moves still reports the height it started at.
- Whether `contain: layout paint` on `.side` is safe, per the note above.

---

## Item 8 — Confirm dark/light contrast holds against WCAG — **done**

Every pair the roadmap named **passes**. A pair it did not name **fails**, and
that is what changed.

**Measured** (sRGB relative luminance, WCAG 2.x formula; ratios computed in
`tests/mobile.test.mjs`, not recorded by hand)

| pair | light | dark | bar |
| --- | --- | --- | --- |
| `.tab` — `--graphite` on `--panel-solid` | 7.31:1 | 10.44:1 | 4.5 (SC 1.4.3) |
| `--graphite` on `--paper` | 6.88:1 | 11.25:1 | 4.5 |
| active `.tab` — `--on-ink` on `--ink` | 19.68:1 | 17.87:1 | 4.5 |
| sheet border `--ink` vs the page behind it | 17.87:1 | 17.87:1 | 3 (SC 1.4.11) |
| sheet border `--ink` vs the sheet fill | 19.01:1 | 16.58:1 | 3 |
| `--muted` on `--paper` **before** | **3.49:1** | 6.47:1 | 4.5 |
| `--muted` on `--panel-solid` **before** | **3.71:1** | 6.00:1 | 4.5 |
| `--muted` on `--paper` **after** | 4.56:1 | 6.47:1 | 4.5 |
| `--muted` on `--panel-solid` **after** | 4.85:1 | 6.00:1 | 4.5 |

**Two corrections to the roadmap**

- `--graphite` is *not* the highest-risk pair. It clears AA with room in both
  themes, at every size it is used at. `.tab` at 0.61rem needs no change.
- `.chart-help` and `.wheel-kicker` do not carry `--graphite`. `.chart-help`
  is `color: var(--ink)` and `.wheel-kicker` declares no colour at all, so it
  inherits `--ink` from `body`. Both are 17.87:1 in both themes. Shrinking
  them to 0.56rem on mobile does not create a contrast problem, because the
  colour was never the marginal one.

**Completed**

- `--muted` in light mode was `#828282` — **3.49:1 on `--paper`, failing SC
  1.4.3's 4.5:1 for small text**. Every light-mode `--muted` use is text
  between 0.52rem and 1rem, well under the 24px "large text" threshold that
  would drop the bar to 3:1: `.note` (0.59rem), `.side-tag` (0.52rem),
  `ul.aspect-key .ak-glyph` (0.66rem), `.setting-switch__option` (0.58rem),
  `.verdict-counts` (1rem), `.designer-lock` (0.65rem), `.designer-pitch`.
  The first three of those render inside the mobile sheet, which is what puts
  this in item 8's scope rather than outside it.
  (`.verdict-score` at 1.7rem = 27.2px *is* large text and was passing at
  3.49:1 against the 3:1 bar; it passes more comfortably now.)
- Changed to `#6f6f6f`: 4.56:1 on `--paper`, 4.85:1 on `--panel-solid`. This
  is the **lightest** neutral grey that clears 4.5:1 against the page
  background, chosen so the fix is the smallest visual change that passes
  rather than a wholesale darkening of every secondary label.
- Dark mode's `--muted` (`#949490`, 6.47:1) already passed and is untouched.
- `--muted` is referenced only in `styles.css`, only as `color`, and never
  from JS or SVG fill — checked before changing it, so there is no drawing
  code depending on the old value.
- **SC 1.4.11, the sheet boundary:** passes, and the roadmap's worry about
  the `box-shadow` doing nothing in dark mode is not a problem. The shadow is
  not load-bearing — the separation is `border-top: 1px solid var(--ink)`,
  which is 16.58:1 against the sheet's own fill and 17.87:1 against the page
  behind it in dark mode. Asserted that the border stays `--ink` so the
  shadow never becomes the only separator.
- 18 new assertions (145 -> 163). They parse the palette out of `styles.css`
  — resolving one level of `var()` aliases, since light-mode `--panel-solid`
  is `var(--paper-bright)`, and layering dark over light the way the cascade
  does — then *compute* each ratio rather than recording it, so moving a
  token has to come back through this suite. Two sanity checks pin the
  formula (white-on-black = 21:1, symmetry). Negative-tested: restoring
  `#828282` turns two of them red with the real 3.49:1 / 3.71:1 numbers.

**Recorded as a decision, not a violation**

`--hairline`, the 1px rule between tab cells, is ~1.5:1 against the sheet
fill in both themes. Not treated as an SC 1.4.11 failure: that criterion
covers visual information *required* to identify a component or its state,
and the active tab is identified by a full `--ink` / `--on-ink` inversion at
19:1, not by the separators. There is an assertion pinning that the active
state stays an inversion, so if it ever becomes a subtler treatment this
reasoning stops holding and the test says so.

**Waived**

- Contrast of text over the wheel graphics, images or gradients. The pairs
  here are all flat token-on-token. Text over the chart wheel or over
  `--paper-translucent` (the desktop `.side` fill, an 0.86-alpha layer)
  composites against whatever is behind it and cannot be resolved without a
  render.
- `--muted` over `--hover` / `--tab-hover` backgrounds: `#6f6f6f` on
  `#e5e5e1` is 4.06:1, still short of 4.5. Not chased here — it is a
  transient hover state on a pointer device, none of the failing selectors
  are hover targets on mobile, and darkening far enough to cover it would
  have meant a much larger visual change than the fix required.
- Non-text contrast of focus indicators, form borders and disabled states.
  Out of the item's scope (sheet and tabs) and a much larger audit.
- Browser suites — see below.

**Needs manual QA on device**

- That `#6f6f6f` still reads as *secondary* next to `--graphite` (`#545454`)
  and `--ink` on a phone screen at 0.52rem. The three greys are now 0x6f,
  0x54 and 0x0b; on a bright outdoor screen the first two may be harder to
  tell apart than intended. This is a legibility/aesthetic judgement the
  maths cannot make.
- Both themes on a real display, including the OS auto-switch, since the
  ratios above are computed in sRGB and a phone panel with True Tone or
  a wide-gamut profile will not render them identically.

---

# Recommendations — items 1, 3, 4, 5, 9

These five were **deliberately not shipped**. Each changes the product's
shape — the default sheet state, where the top-right controls live, whether
all five tabs stay, a new first-run hint surface, and what a cold visit
shows — and those are the owner's calls, not this run's. What follows is the
investigation each item's bullets asked for, a concrete recommendation with
the diff that would make it, and the tradeoff. Nothing below is applied to
the branch; where something was coded far enough to check the recommendation
holds, that is said explicitly and the code was not kept.

---

## Item 1 — Default mobile sheet state and what's visible in it — **recommendation**

**What is actually true today** (re-checked against the file, not the
roadmap's line numbers)

- `wireSheet()` seeds `state` from `localStorage['astropitch.sheetState']`
  and falls back to `'half'`. The drag and tap handlers early-return unless
  `mode === 'mobile'`, so desktop never writes that key — the roadmap's
  correction here is right, there is no inherited desktop state.
- `recomputeHeights()` sets `peek` to `Math.round(Math.max(56, handleH +
  tabsH))`. The `76` in
  `html[data-mode="mobile"] .side { height: var(--sheet-peek-h, 76px) }` is
  only the pre-measurement fallback; JS overwrites it on the first
  `setSheetMode('mobile')`. So `peek` today is roughly a 44px handle plus a
  ~45px tab strip — **the collapsed sheet is the whole five-tab strip and
  nothing else**. It is not transport-only, and it never was.
- `expandSheetIfPeeking()` is called from `select()` on *every* tab
  activation, including the keyboard arrow path, and promotes `peek → half`.
  It exists precisely because a tab tapped at peek would otherwise reveal
  nothing.

**Recommendation: change the fallback to `peek`; do not hide the tab strip.**

The two halves of the roadmap's candidate should be split, because only one
of them is cheap and only one of them is clearly right.

*Do this — one line:*

```
-  let state = SHEET_STATES.includes(stored(SHEET_KEY)) ? stored(SHEET_KEY) : 'half';
+  let state = SHEET_STATES.includes(stored(SHEET_KEY)) ? stored(SHEET_KEY) : 'peek';
```

A first mobile visit then lands on wheel + transport + a 90px tab strip,
which is as close to "the wheel is the objective" as this costs. Returning
visitors keep whatever they last left, which is the right behaviour: someone
who works at `half` should not be reset every session. **Honour the persisted
value** — do not clear it. The key is only ever written from mobile, so there
is no stale-desktop-state problem to solve, and resetting it would punish
exactly the users who have expressed a preference.

*Do not do this — hiding `.tabs` at peek.* It needs three coordinated
changes (a `.tabs` visibility rule keyed off a peek class, dropping `tabsH`
from the `peek` formula, and re-deciding `expandSheetIfPeeking`) and it
takes away the app's only visible affordance that there *is* anything below
the wheel. A 90px strip showing five words is not the crowding problem; the
`half` sheet covering 52% of the screen on arrival is. Fixing the default
gets most of the benefit for a hundredth of the risk. If the strip still
feels heavy afterwards, that is item 4's question (five tabs), not this one.

**Tradeoff, stated plainly**

Landing on `peek` means the Chart form — the thing a new user must reach to
do anything — starts off-screen. That is a real cost and it is the argument
for `half`. Two things blunt it: `expandSheetIfPeeking()` already promotes
the sheet on any tab tap, so the form is one tap away and that tap is on a
visible, labelled target; and item 9's recommendation (seed the sky chart)
means the first visit has something to hear before it has anything to type,
which is what makes a collapsed sheet defensible rather than obstructive.
**These two items should be decided together.** `peek` as a default with an
empty wheel behind it would be worse than what exists now.

**Cost:** one line, plus a test. `tests/mobile.test.mjs` does not assert the
default state at all today, so the change is currently unguarded — the diff
should come with an assertion that the fallback is `peek` and that a stored
value still wins over it.

**Not verifiable here:** whether `peek` reads as "there is more below" or as
"the controls are gone" on a real screen. That is the entire question and it
needs a phone.
