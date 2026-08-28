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
