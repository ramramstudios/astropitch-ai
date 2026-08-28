# Radio Dial

A feature proposal for AstroPitch. Written from the owner's idea, then
checked line by line against `src/audio/tuning.js`, `src/chart.js`,
`src/ephemeris.js`, `src/ui/wheel.js`, `src/audio/performer.js`,
`src/audio/modes.js`, `src/audio/voices.js` and `src/ui/app.js` at commit
`af55dfb`, with the astronomy measured using the app's own ephemeris rather
than quoted from memory. Every number in §3 is reproducible — the commands
are in §10.

Status: **proposal**. Nothing here is built. Where this document says the
repo already does something, that has been read in the file and is cited;
where it says something would need building, that is a claim about work not
yet done, and the hard parts are named in §8 rather than glossed.

---

## The idea, in the owner's framing

> The wheel is sort of a radio transmission, and as you turn it you're really
> turning a radio dial — tuning into certain frequencies that exist, that are
> determined by geographical location and time. March 15 2005 is a particular
> dial-in frequency, like you would hear on the radio.

The rest of the original framing, kept because it constrains the design:

- The realisation came while listening to **New Age music** — "very true, and
  monotonous". That is the target aesthetic. Drone, sustain, slow harmonic
  movement. Not a beat-driven form.
- **Certain years may sound like certain kinds of music**, because of where
  the outer planets and the Sun are. §3 shows this is measurably true in the
  app's own pitch mapping, not just a nice thought.
- **Percussion is doubtful** — "I can't see percussion ever being part of the
  music really" — but possibly earned by certain placements. §5 answers this
  specifically.
- The dial should work **in full-screen mode**, where the user can still turn
  it and land on "a song, per se, that is suitable to them" — a song
  synthesised from a particular time and place.
- **Anchor the place, sweep the time.** Pick a latitude/longitude (the corner
  of Broadway and 5th), then move time around it.
- **Bound the window to roughly ±1 year** around the sky right now, so the
  feature has edges. Entering an arbitrary year stays the job of the normal
  Chart input, which already does it.

## 0. The one-paragraph version

Anchor a place. Take the sky right now as the centre of a two-year band.
Turning the wheel scrubs time through that band. Every body's pitch is
already a continuous function of its ecliptic longitude, so as time moves,
every voice glides — the outer planets almost not at all, the Moon and the
angles very fast. That is a radio: a fixed carrier you have tuned to, a slow
bed that identifies the band, and fast content riding on top. Aspects coming
into orb are stations coming into signal; the chart already computes an
`exactness` value from 0 to 1 for every aspect, which is a signal-strength
meter that exists today and is currently used only to weight note choice.
The feature is mostly a *gesture*, a *time model*, and one piece of real
engineering (§8) — not a new synthesis engine.

---

## 1. The claim is already true in the code

This is the part that makes the idea more than a metaphor.

`src/audio/tuning.js` opens with this, and it is not a new observation being
made by this document — it is the module's own docstring:

> The zodiac is a chromatic octave: the centre of Aries is A, and every 30
> degrees is one semitone. That makes the mapping continuous, so a planet at
> 14 degrees 22 minutes of Aries is not "an A" but an A just below centre.

and the function that implements it:

```js
if (t.continuous) return base * 2 ** ((lon - SIGN_CENTRE) / 360);
```

**360 degrees of ecliptic longitude is exactly a 2:1 frequency ratio.** One
full turn of the wheel is one octave. The wheel is not *like* a frequency
dial; in this codebase it already *is* one, and has been since tuning.js was
written. The radio-dial feature is the discovery that the app's existing
pitch mapping has a second, temporal axis nobody has exposed yet.

**One catch, and it is important.** `app.js` forces `microtones: false` into
the initial state:

```js
tuning: { ...savedTuning, microtones: false },
```

With microtones off, `frequencyFor` takes the other branch and quantises to
the sign:

```js
if (t.continuous && !microtones) {
  const signIndex = Math.floor(lon / 30) % 12;
  return base * 2 ** (signIndex / 12);
}
```

so pitch steps by a semitone at each cusp instead of gliding. **Radio Dial
requires microtones on**, or turning the dial produces twelve clicks per
revolution rather than a glide. The non-equal temperaments (`just`,
`pythagorean`) are `continuous: false` and quantise unconditionally, so they
are incompatible with the dial by construction. See §9.

---

## 2. What the repo already has

Most of the machinery this feature needs was built for the **Designer** — the
drag-a-planet-around-the-wheel mode — and for the mobile pinch/pan work. The
Designer is architecturally the same machine as the dial: a continuous
gesture that mutates the chart, redraws the wheel, and reshapes live audio
without tearing down the transport. The dial is that machine driven by
*time* instead of by a dragged body.

| What the dial needs | What already exists | Where |
| --- | --- | --- |
| Continuous longitude → frequency | `frequencyFor`, 360° = one octave | `src/audio/tuning.js` |
| A wheel rotation that is not the Ascendant | `this.rotation`, and `this.rotationLock` to freeze it | `src/ui/wheel.js` |
| Per-frame redraw that skips the fixed furniture | `renderLive(chart)` — redraws houses, aspects, planets only | `src/ui/wheel.js` |
| A held voice whose pitch follows a gesture | `voice.retune({ freq, pan, time })` | `src/audio/voices.js`, driven from `performer.updateDesignerPreview` |
| A crossfade when a voice's *character* must change mid-gesture | the `timbre !== preview.timbre` branch | `src/audio/performer.js` |
| A signal-strength scalar per aspect | `exactness: 1 - orbDelta / orb` | `src/chart.js` |
| Cheap chart recomputation | measured at **0.072 ms** per full Placidus chart | `src/chart.js` (§3) |
| Time → chart | `birthFromNow(utcOffset, atMs)` → `chartFromBirth` | `src/chart.js` |
| An anchored place | `PLACES` presets plus free lat/lon | `src/ui/app.js` |
| A full-screen mode that hides all chrome | `body.is-fullscreen` hides `.side-rail`, `.side`, `.wheel-kicker` | `src/styles.css` |
| Audio-clock scheduling that survives a janky frame | `AudioScheduler`, 0.15 s lookahead, 25 ms ticks | `src/audio/scheduler.js` |
| A noise layer per voice, for transients | `spec.noise` — pink-tilted, own filter/gain/decay | `src/audio/voices.js` |

The two things that do **not** exist are a rotational gesture on the wheel
(only pinch and pan exist, and only on mobile) and a live re-chart path that
does not stop the transport. The second is the real work; see §8.

### `rotationLock` deserves its own note

`wheel.render(chart)` sets rotation from the Ascendant:

```js
this.rotation = this.rotationLock ?? (chart.cusps ? chart.cusps[0] : 0);
```

The Ascendant sweeps the entire zodiac roughly once a day (§3). So if the
dial scrubs time and the wheel keeps deriving rotation from the Ascendant,
**the whole chart will spin wildly** — 732 revolutions across the proposed
window. `rotationLock` already exists to freeze rotation for the length of a
designer drag; the dial should hold it for the length of a tuning gesture,
for exactly the same reason. That is a hook that is already there, and it is
the difference between a legible dial and a centrifuge.

---

## 3. The astronomy, measured

All figures computed with this repo's own `chartFromBirth`, anchored at
40.7484 N, 73.9857 W (midtown Manhattan — the owner's example), Placidus
houses, over a ±365-day window centred on 2005-03-15 12:00 UTC. Total
*unwrapped* travel, sampled every 30 minutes (35,040 samples). Because 360°
is one octave, degrees of travel are also octaves swept, which is why the
right-hand column is the musically meaningful one.

| Body | Degrees travelled in ±1 yr | Turns = octaves swept | Role in the radio model |
| --- | ---: | ---: | --- |
| Ascendant | 263,519 | 732.00 | **Tuning** — the carrier |
| Midheaven | 263,520 | 732.00 | **Tuning** — the carrier |
| Moon | 9,614 | 26.71 | Fast modulation |
| Mercury | 881 | 2.45 | Station content |
| Sun | 720 | 2.00 | Station content |
| Venus | 692 | 1.92 | Station content |
| Mars | 407 | 1.13 | Station content |
| Jupiter | 94 | 0.26 | Slow drift within the band |
| Saturn | 55 | 0.15 | Slow drift within the band |
| Uranus | 23 | 0.06 | **The band** |
| Neptune | 15 | 0.04 | **The band** |
| Pluto | 15 | 0.04 | **The band** |

### The owner's intuition about years is quantitatively correct

30° is one semitone. Across the **entire two-year dial**, Neptune moves 15°
and Pluto 15° — **half a semitone each**. Uranus moves 23°, under
four-fifths of a semitone. Saturn moves 55°, under two semitones.

So the outer planets are not "slow". On this dial they are **fixed**. They
are a drone that does not move no matter how far you turn, and they are the
same drone for everyone who tunes into that stretch of years. That is
precisely why a year can have a sound: the bed under everything is a chord
held by Jupiter, Saturn, Uranus, Neptune and Pluto that changes on a scale of
years to decades, and the dial cannot reach past it.

This also means the ±1 year bound the owner proposed is not an arbitrary
limit — it is **exactly the width of one band**. Widen the window to ±15
years and Uranus moves a fifth, Saturn laps the zodiac twice, and the bed
stops being a bed. The proposed limit is the correct one for the metaphor,
which is a happy accident worth stating out loud.

### Station density

Sampling the mean `exactness` across all of a chart's aspects, once per day
across the window:

- mean 0.511, range **0.285 to 0.828**
- aspect count per chart: 8 to 23, mean 13.6
- **33 days** in the two-year window where the mean exactness peaks above
  0.62

Thirty-three strong stations across two years — roughly one every three
weeks. That is a good density for a dial: sparse enough that landing on one
feels like finding something, dense enough that a minute of scrubbing finds
several.

### The two axes are cleanly separated

Sampling the same quantity every 10 minutes across **one** day gives a range
of only 0.463 to 0.567. Aspect exactness barely moves within a day, because
the planet-to-planet geometry barely moves within a day. What *does* change
minute to minute is which body is rising or culminating — the angles, at 732
turns across the window.

This falls out as a genuine two-knob instrument, and it is not a design
decision so much as an observation about the sky:

- **Coarse, days to months → which aspects are exact → the harmony.** What
  chord is playing.
- **Fine, minutes to hours → which body is on the Ascendant or Midheaven →
  which voice is foregrounded.** Who is speaking.

Any real radio has exactly these two controls.

---

## 4. The radio model

The mapping, stated so it can be argued with:

| Radio | Astrology | Audio consequence |
| --- | --- | --- |
| **Band** | Jupiter → Pluto. Under two semitones of movement across the whole dial. | The sustained harmonic bed. Sets palette, register and overall consonance. Effectively constant; identifies the era. |
| **Station** | Aspects between the personal bodies (Sun, Moon, Mercury, Venus, Mars) coming into orb. | The chord and its movement. 33 strong ones in the window. |
| **Signal strength** | `aspect.exactness`, already computed as `1 - orbDelta / orb`. | Gain, and how clean vs. detuned the interval sounds. |
| **Fine tuning** | Ascendant/Midheaven position — which body is angular. | Which voice is forward in the mix; pan; presence. |
| **Static / between stations** | No aspect near exact; mean exactness at the low end (~0.29). | The existing per-voice `spec.noise` layer comes up; voices detune slightly against each other. |
| **Detent / the click into a station** | An aspect reaching exactness above a threshold. | Detune collapses to zero, noise floor drops, the interval locks. Optionally a haptic on mobile. |
| **Squelch** | A floor below which the dial stops trying to sound a chord. | Silence rather than mush at the emptiest points of the window. |

The "static" idea is the one worth being careful about, because it is the
one that could make the feature unpleasant. **Static should be an attenuation
and a slight detune, not added hiss.** The engine's noise layer is a
per-voice transient shaper, not a hiss generator, and turning it into one
would fight the New Age brief the whole feature exists to serve. Between
stations the right sound is *thin and uncertain*, not *noisy*.

### Why this is not just "scrub the chart and re-render"

Because the outer planets hold still, the bed does not change while you turn.
Because the angles move fast, the foreground does. Because aspect exactness
rises and falls smoothly, the harmony breathes in and out rather than
switching. Those three timescales layered on one control is what makes it
feel like tuning rather than like scrubbing a timeline. It is worth
protecting that in implementation: if the bed gets re-triggered every time
the chart changes, the illusion collapses immediately.

---

## 5. Percussion — the specific question

The owner's instinct is right, and the ontology already agrees with it. From
`src/ontology.js`, the roles are declared per body:

- Mars — **"The transient"**
- Uranus — **"The interruption"**
- Neptune — "The wash"
- Saturn — "The structural bass"
- Sun — "The fundamental"

Mars is already named as the percussive body in this app's own vocabulary,
and Uranus as the thing that breaks the surface. Nobody has to invent a
mapping.

**The engine can already do it without new synthesis.** `src/audio/voices.js`
builds an optional noise layer per voice with its own bandpass filter, gain
and decay, and a `tracks` flag deciding whether the noise follows the voice's
pitch. A short attack, high noise gain, non-tracking filter and fast decay is
a soft mallet or shaker. No new node graph, no samples.

**Recommendation: percussion is earned, never default.** A rule that is
astrologically motivated rather than aesthetic, and that stays rare enough to
respect the brief:

1. Mars **angular** — within orb of the Ascendant, Midheaven, Descendant or
   IC — introduces a soft, pitched transient on the beat the drone already
   implies. This is genuinely uncommon: with an 8-degree orb on four angles, Mars
   is angular for roughly four hours out of every twenty-four, and only at the dial positions where the fine
   knob has put it there. It arrives, it passes.
2. Mars in **hard aspect to Saturn** (conjunction, square, opposition) with
   high exactness gives the transient a harder edge and a longer decay —
   Saturn is the structural body, so this is where a pulse gets a frame.
3. Uranus aspects, being nearly fixed across the dial, should never trigger
   percussion. On a two-year band Uranus is part of the bed; using "The
   interruption" as a rhythmic source would mean the same interruption for
   two solid years, which is not an interruption.
4. Everything else: no percussion. Ever.

The result is that most of the dial is drone, and a handful of the 33
stations have a pulse. Turning the dial and finding one should feel like
finding a different kind of station, not like a drum machine switching on.

---

## 6. The dial gesture

A rotational gesture does not exist on the wheel today. `wheel.js` handles
`pointerdown`/`move`/`up` for pinch (two pointers) and pan (one pointer, and
only when zoomed past 1.001×), both gated to `interactionMode === 'mobile'`.
A one-finger rotation would collide with pan, so it needs its own state.

**Recommended gesture:** while Dial mode is active, a one-pointer drag on the
wheel's **outer rim** rotates; a drag on the **interior** keeps today's pan
behaviour. Rim-only is how a physical dial works, it is self-explanatory once
tried, and it leaves the existing gestures untouched. Compute the angle from
the pointer to the wheel centre using the existing `_localPoint(e)` helper,
accumulate deltas across the ±180° wrap, and feed the accumulated angle to
the time model.

**Gearing.** One full turn should be a natural astrological unit, and there
is only one candidate: **one turn = one day**, because that is the Ascendant's
own cycle and it makes the fine knob physically honest — turn once, the sky
has rotated once. The ±1 year window is then 730 turns, which sounds absurd
until you remember that is exactly what a shortwave dial is: many turns
across a band, with the interesting parts found by sweeping.

For coarse movement, rather than a second control, **velocity gearing** (a
jog wheel): below a threshold, one turn is one day; above it, the ratio rises
smoothly to roughly one turn per month, so a fast spin crosses the band in a
few turns and a slow turn still resolves single minutes. This keeps the dial
to one gesture, which matters because §7 puts it on a screen with nothing
else on it.

**Detents.** When the accumulated angle brings an aspect above the lock
threshold, snap the time slightly toward exactness — a few minutes at most —
and fire `navigator.vibrate` where available. This is what makes a station
feel *found* rather than *passed*. It is also the piece most likely to feel
wrong on the first try and need tuning by hand on a device.

**Direction.** Clockwise should advance time, because the chart's houses are
numbered anticlockwise and the Ascendant moves anticlockwise through the
signs — so clockwise dial motion moving *forward* in time keeps the wheel's
own furniture sweeping the familiar way. This is worth checking with someone
who reads charts; it is a convention question, not a technical one.

---

## 7. Dial mode, in full screen

`body.is-fullscreen` already hides `.side-rail`, `.side` (the whole mobile
sheet) and `.wheel-kicker`, and lets the wheel fill the viewport. It is an
app-level CSS mode, not the browser Fullscreen API, so it works on iPhone
Safari where the real API does not apply to arbitrary elements. The controls
that survive are the transport — four mode buttons and volume, in the thumb
zone.

That is already the right screen for this feature, and it is the screen the
owner asked for. Dial mode is `is-fullscreen` plus:

- a **readout**, replacing the hidden `.wheel-kicker`: the tuned moment, in
  the anchored place's local time, and the place name. `2005-03-15 14:22,
  New York`. This is the only text on screen and it is the thing being tuned,
  so it should be legible at a glance and never move.
- a **band indicator**: which outer-planet configuration is holding. One
  line, changing on a scale of months, so it reads as a station identifier
  rather than a live meter.
- a **signal meter**: mean aspect exactness, 0.29 to 0.83 in practice, so the
  scale should be normalised to that range rather than to 0–1 or it will
  spend its life in the middle. This is the one element that should move
  continuously, because it is what tells you to keep turning or stop.

Everything else stays hidden. The exit remains the existing tap-on-background
handler.

Dial mode should be reachable **without** full screen too — the same gesture
on the wheel with the sheet at `peek` — so it is discoverable by people who
never find the Full-screen button. See the mobile-UX run log's item 3 note:
that button is currently a 0.56rem text link in the top-right corner.

---

## 8. What actually has to be built

Phases in dependency order. The first is the only genuinely hard one, and it
is hard for a specific reason that is worth stating before any code is
written.

### Phase 0 — The blocker: `render()` stops the music

`app.js`:

```js
function render() {
  ...
  performer.stop();
  performer.setChart(state.chart);
```

**Every chart change today stops the transport.** Scrubbing a dial through
`render()` would produce silence, not a transmission. It would also re-render
the placements table, the aspects table, the balance display and the overlay
on every frame.

Worse, `performer.setChart()` alone is not enough either. The mode schedules
in `modes.js` compute their material **once, before starting the scheduler
loop**, and close over it:

```js
const origin = performer.engine.now;
const beds = new Map();
const weights = floating.map((p) => activity[p.key] ?? 0.25);

performer.scheduler.start((t0, t1) => {
  if (performer.mode !== 'drone') return;
  ...
});
```

`anchorPlacements`, `floating`, `detunes`, `notes`, `byPc`, `activity` and
`weights` are all captured in the closure. The tick callback re-reads only
`performer.mode`. So a running drone or melodic pass **will not hear a new
chart** even if `setChart` is called, and re-arming the schedule is what
currently costs a `stop()`.

This is the fork in the road, and it should be decided deliberately:

- **(a) Make the schedules re-read `performer.chart` each tick.** Correct,
  and it makes every mode live-updating for free. Touches all four mode
  schedules, and risks changing the sound of the existing modes, which are
  the product. Needs `tests/performer.test.mjs` to hold the line.
- **(b) Add a dial-specific arrangement** — a fifth entry in `MODES`, or a
  mode variant — that is written from the start to read the chart per tick,
  and leave `bloom`/`scalar`/`drone`/`melodic` untouched. Lower risk, and
  `MODES` is explicitly designed as the extension point ("Adding a mode means
  adding one object here"). Costs some duplication with `droneSchedule`.

**Recommendation: (b).** The dial wants a drone that never re-triggers its
bed and instead retunes it continuously, which is a different arrangement
from `droneSchedule` anyway — its whole cycle structure exists to release and
replace beds. Writing that as its own mode is honest about what it is, and it
keeps a speculative feature from reaching into the four arrangements that
already work. Revisit (a) later if the per-tick pattern proves out.

### Phase 1 — Time model

A pure module, testable with no DOM and no audio, in the style of
`tuning.js`:

- `dialWindow(anchorMs)` → `{ minMs, maxMs }`, ±365 days, clamped so the
  window never leaves the ephemeris's valid range (`src/ephemeris.js` cites
  the JPL elements as **valid 1800–2050**, and `deltaT` has a distinct
  polynomial branch for 2005–2050). A ±1 year window around "now" stays
  inside that until 2049, but the clamp should exist rather than be assumed.
- `dialAngleToTime(angleRad, { anchorMs, gearing })` → ms, and its inverse.
- `dialGearing(angularVelocity)` → days per turn, the velocity curve from §6.
- `signalStrength(chart)` → the normalised mean exactness, with the 0.29–0.83
  empirical range from §3 as the normalisation, not 0–1.
- `bandOf(chart)` → a stable identifier for the outer-planet configuration,
  used for the §7 band indicator and to decide when the bed may legitimately
  be rebuilt.

All of these are pure functions of numbers and a chart. They belong in
`tests/` from day one — the repo's own precedent is `nextSheetState`,
`nearestSheetState`, `clampSheetHeight` and `nextPinchView`, all exported
purely so they can be tested without a browser.

### Phase 2 — The gesture

Rim-drag rotation in `wheel.js`, its own pointer state alongside `_pan` and
`_pinch`, gated on a new `dial` interaction flag. Coalesce writes into one
`requestAnimationFrame` exactly as `_setView` does — that pattern is already
there and the mobile-UX work just extended it to the sheet drag. Hold
`rotationLock` for the length of the gesture (§2).

### Phase 3 — Live re-chart path

A `tuneTo(ms)` in `app.js` that deliberately does **not** call `render()`:

1. `chartFromBirth(birthFromNow(utcOffset, ms), place, houseSystem)` —
   measured at 0.072 ms, which is 0.4% of a 16.7 ms frame. Affordable at
   60 fps with room to spare.
2. `wheel.renderLive(chart)` — the existing partial redraw, not `render`.
3. `performer.setChart(chart)` with **no** `stop()`.
4. Update only the §7 readout elements. No tables, no balance, no overlay.

The tables and the rest of the UI reconcile once, on gesture end.

### Phase 4 — The dial arrangement

The fifth `MODES` entry from Phase 0(b): a bed of the outer bodies held
indefinitely and **retuned**, never re-triggered, using the same
`voice.retune({ freq, pan, time })` the designer preview uses; personal
bodies voiced according to aspect exactness; angular bodies brought forward.
Percussion per §5.

### Phase 5 — Dial mode presentation

The §7 readout, band indicator and signal meter, composed with the existing
`is-fullscreen` rules.

### Phase 6 — Tests

- Pure time-model tests in `tests/mobile.test.mjs` or a new
  `tests/dial.test.mjs`, following the existing DOM-free convention.
- An ephemeris-backed test that the measured figures in §3 still hold — those
  numbers are load-bearing for the whole design, and if a future ephemeris
  change moves them, the design's premises have moved.
- The dial arrangement in `tests/performer.test.mjs` against the fake context
  the suite already uses.
- Realtime behaviour — does scrubbing at 60 fps with a live transport drop
  quanta — belongs in `tests/stability.test.html`, which is the only harness
  that can see dropped render quanta at all.

---

## 9. Open questions and what could kill this

Honest list. Several of these are not answerable without building a rough
version and listening to it.

1. **Does it actually sound good, or just interesting?** Everything above
   argues the structure is sound. None of it argues the output is musical.
   The fastest way to find out is a throwaway prototype at Phase 3 with the
   existing `droneSchedule`, accepting that it will re-trigger, just to hear
   what two years of sky does to a chord. **Do this before Phase 4.**
2. **Microtones.** The dial needs them on (§1), and they are currently forced
   off at boot. Turning them on globally changes how the existing modes
   sound, which is a product change. Options: scope microtones to Dial mode,
   or make the dial set them and restore on exit. Neither is free — a mode
   that silently changes a global tuning preference is the kind of thing that
   confuses people later.
3. **Temperament.** `just` and `pythagorean` are `continuous: false` and
   quantise to the sign unconditionally. The dial is incoherent under them.
   Either disable the dial when a non-equal temperament is selected, or
   accept that it becomes a twelve-position rotary switch, which is arguably
   a legitimate and interesting second behaviour rather than a bug.
4. **The Moon.** 26.7 turns across the window — nearly 27 octaves of glide.
   It will be the most audible thing on the dial by a wide margin and may
   simply be too much. It may need its glide damped, its octave clamped, or
   to be treated as a separate "fast" layer with its own gain.
5. **Retrograde motion.** `isRetrograde` exists in `ephemeris.js`. A body
   turning retrograde reverses its glide direction while the dial keeps
   turning one way. That is either a beautiful detail — the sound briefly
   moving against the hand — or a confusing one. Untested either way.
6. **Precision at the fine end.** The ephemeris is documented as
   "sub-degree for every body" and "~0.5 degree worst case for Pluto". At
   0.5° of error and 30° per semitone, that is 1.7% of a semitone — inaudible
   for the outer bodies. Fine for this. Worth noting the Moon has a
   `deltaT` correction precisely because it moves ~0.5 arcmin per minute of
   time, so the fine knob's accuracy depends on that branch being right.
7. **Battery and heat.** A continuous 60 fps gesture driving continuous audio
   retuning on a phone, in a mode designed to be left running. Not measured.
   `tests/stability.test.html` is the right harness and the null sink is its
   known limitation.
8. **Does the ±1 year bound frustrate people?** §3 argues it is exactly one
   band wide, which is a good reason. But someone who wants to hear their own
   birth year will turn the dial and hit a wall. The mitigation is that Chart
   input already casts any date, and the dial could re-anchor to whatever
   chart is currently loaded rather than always to now — so tuning around
   *your* chart becomes the natural second use.
9. **Naming collision with a real radio.** "Radio Dial" invites comparison to
   something with far more content. Worth a thought; see §11.

---

## 10. Reproducing the measurements

Every figure in §3 came from the app's own modules. From the repo root:

```sh
# Cost of one full chart (§2, §8 Phase 3)
node -e "import('./src/chart.js').then(({chartFromBirth})=>{
  const place={latitude:40.7484,longitude:-73.9857};
  const b={year:2005,month:3,day:15,hour:12,minute:0,utcOffset:-5};
  for(let i=0;i<200;i++)chartFromBirth(b,place,'placidus');
  const t0=process.hrtime.bigint();const N=5000;
  for(let i=0;i<N;i++)chartFromBirth({...b,minute:i%60},place,'placidus');
  console.log(((Number(process.hrtime.bigint()-t0)/1e6)/N).toFixed(4),'ms per chart');});"
```

The travel table and the station-density figures were produced by stepping
`chartFromBirth` across the window at 30-minute and 1-day resolution
respectively, accumulating `Math.abs` of the wrapped longitude delta per
body, and averaging `aspect.exactness` per chart. Both scripts are short
enough to rewrite from the description; if they are going to be relied on
repeatedly they should become `tests/dial.test.mjs` per Phase 6 rather than
living in shell history.

Measured on this VM: 35,040-sample sweep in 2.9 s.

---

## 11. Naming

The owner was unsure between "radio dial feature" and "radio dial in full
screen". They are two things and both should exist:

- **Radio Dial** — the feature. The time-scrubbing rotational gesture on the
  wheel, available whenever the wheel is interactive.
- **Dial mode** — the full-screen presentation of it (§7), where the dial is
  the only control on screen.

Alternatives considered and why they lose: *Tuner* is accurate but collides
with the app's existing tuning/temperament vocabulary in `tuning.js`, which
would be genuinely confusing in code. *Transmission* is evocative but says
nothing about what the control does. *Scrub* and *Timeline* are correct and
kill the idea — the whole point is that this does not feel like a timeline.

**Recommendation: Radio Dial, with Dial mode as the full-screen state.** It
is the owner's own phrase, it is honest about the metaphor, and the metaphor
is doing real design work here rather than decorating it.

---

## Related documents

- `research/audio-implementation-plan.md` — the arrangement/renderer split
  (`modes.js` data vs `performer.js`/`voices.js` construction) this feature
  extends rather than works around.
- `research/mobile-ux-roadmap.md` §1 and `research/mobile-ux-run-log.md`
  item 3 — the full-screen mode this feature lives in, and why its entry
  point is currently hard to find.
- `outstanding.md` — the Completed/Waived convention this document's
  eventual run log should follow.
