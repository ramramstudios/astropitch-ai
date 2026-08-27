# AstroPitch

AstroPitch is a browser-based astrological sonification system. Zodiac longitude
maps to pitch; chart structure controls timbre, articulation, register, and
relationships between notes.

This is the technical reference; it assumes familiarity with astrology, music
theory, and Web Audio. The in-app **How it works** guide is the shorter,
astrology-first introduction.

No build step, dependencies, or API: static files and the Web Audio API.

## The idea

Each sign occupies a pitch region. **Chromatic** locks a sign to one pitch;
**Gliss** moves continuously through it. Temperament is a separate choice. In
Equal temperament, Chromatic maps Aries to A, Taurus to A♯, ... Pisces to G♯;
Gliss sets the center of Aries to the reference A (default 432 hz):

```
30° of ecliptic longitude  ==  1 semitone
one trip around the zodiac ==  1 octave

Gliss frequency = A × 2^((longitude - 15) / 360)
```

The conversion is arithmetic, not a lookup table, so **every aspect is an
interval**: the shortest undirected distance between two placements, topping
out at 180°/the tritone (angles beyond that are inversions of intervals
already listed):

| Aspect      | Angle | Semitones | Interval       |
|-------------|-------|-----------|----------------|
| Conjunction | 0°    | 0         | unison         |
| Sextile     | 60°   | 2         | major second   |
| Square      | 90°   | 3         | minor third    |
| Trine       | 120°  | 4         | major third    |
| Quincunx    | 150°  | 5         | perfect fourth |
| Opposition  | 180°  | 6         | tritone        |

## What makes a placement sound the way it does

A placement is a stack of independent musical decisions: the **sign** supplies
pitch region, element (timbre), and modality (articulation); the **house**
supplies a performance gesture; the **planetary body** places the result in
the ensemble (register, gain, role); **aspects** describe relationships
between placements without replacing either one's instrument.

| Layer | Comes from | What it changes in sound |
|---|---|---|
| **Pitch** | Sign (+ exact degree in Gliss) | Fundamental pitch |
| **Timbre** | Element | Oscillator stack, harmonic density, noise, sub, resonance, spectral tilt, drift, default space |
| **Gesture** | House | Attack/filter contours; gating, glide, doubling, or FM |
| **Articulation** | Modality | Base ADSR contour and vibrato depth, multiplied by the house gesture |
| **Register / role** | Planetary body | Octave, gain, arrangement priority |
| **Relationship** | Aspects | The interval two placements form, and its importance/activity |

| Element → Timbre | Heard as |
|---|---|
| **Fire** | bright, dense, urgent (beating saws/square, sharp noise attack, soft clipping) |
| **Earth** | weighty, wooden, contained (triangles/sines over a strong sub, box resonance) |
| **Air** | hollow, breathy, wide (odd-rich pulse, octave shadow, wide stereo) |
| **Water** | smooth, unstable, submerged (detuned sine/triangle, slow filter drift, low-index FM, long reverb) |

| Modality → Articulation | Heard as |
|---|---|
| **Cardinal** | initiating: near-instant onset, lower sustain, shorter decay |
| **Fixed** | held: slower onset, high sustain, long release |
| **Mutable** | changing: moderate onset/sustain, most base vibrato |

Houses shape the element's timbre rather than replacing it (envelope/filter
changes, noise/sub weight, image width, time-based behaviors); full table of
all twelve in `palettes.js`. This yields 12 sign recipes × 12 house gestures =
144 combinations before body register and aspects are applied; all 144 are
synthesized, not sampled, and covered by `palettes.test.mjs`.

Body register follows physical size: the Sun anchors the bottom (doubled in
unison three octaves apart); each smaller body sits a register higher, up to
Pluto at the top. Sun and Moon stay loud regardless of register; outer
planets are more atmospheric.

ASC and MC are directional references, not standalone sounding bodies, off
by default, and switching either on only affects aspects and elemental
balance; neither ever joins Bloom, Scalar, Drone, or Melodic as a chord tone.
Click a direction label to filter the wheel to its aspect network. DSC/IC
always mirror MC/ASC and aren't independently listed.

During an aspect audition, both bodies are temporarily brought to the same
octave so the interval is literal. Exactness affects importance, not any
oscillator setting: exact contacts are ordered first, and in Drone mode
tighter-aspected bodies surface more often.

## Chart inputs

**Input** calculates a chart from date, time, location, UTC offset, and house
system, using the included in-browser ephemeris (no external API). You must
supply the UTC offset actually in force at the birth moment; historical DST
can't be derived from coordinates.

**Basic** places a body at 15° of a manually chosen sign, for when only the
sign is known.

**Designer** builds a chart by hand on top of either of those: drag any of
the ten planets around the wheel (sign, house, pitch, and aspects recompute
live), or press-and-drag a direction label (ASC/MC/DSC/IC) to turn the whole
sky; only the Ascendant is actually stored, the rest follow it. The design
is stored separately from the cast chart, so *Revert chart* always has
somewhere to go back to.

Each body has a switch (including ASC/MC, off by default). Switching a
planet off drops it from aspects, elemental balance, and all four playback
modes: the fastest way to hear a chart without its Saturn.

## Two charts at once

The **Overlay** tab plays a chart against the sky right now, or against
another person's chart. Neither chart is transposed: both are tuned by the
same rule, so a cross-chart trine really is a major third, and a cross-chart
conjunction's orb is audible directly as a beat rate (e.g. 3° orb ≈ 2.5 Hz
tremble at A 432, converging to one fused tone at 0°).

Density is controlled by the astrology, not a fixed rule: of the ~40 aspects
two charts throw between them, the strongest eight are kept, and only the
bodies involved in those sound (typically 12-13 voices instead of 22).
Bodies touching nothing in the other chart are drawn dimmed and listed as
silent. `synastry.test.mjs` pins these guarantees (shape, no transposition,
orb→beat-rate).

## The astronomy

- **Sun**: Meeus ch. 25. Matches the ch. 25 worked example to 0.001°.
- **Moon**: Meeus ch. 47, full 60-term longitude series with eccentricity
  correction and Venus/Jupiter additive terms. Matches example 47.a to five
  decimal places.
- **Planets**: JPL's approximate Keplerian elements with per-century rates,
  Kepler solved by Newton iteration, precessed to the equinox of date. Within
  0.32° of JPL Horizons across all eight.
- **Houses**: whole sign, equal, or Placidus by semi-arc division (iterating
  each cusp's own ascensional difference), falling back to Porphyry inside
  the polar circles where Placidus has no solution.

Accurate enough for astrology, not for navigation.

## The audio engine

Raw Web Audio, no library. One signal graph is built once and reused for the
life of the page:

```
voices ─┬─────────────────────────────────────────────┐
        ├─ reverb send → pre-delay → IR → damping ────┤
        └─ delay send  → ping-pong → damped feedback ─┤
                                                      ▼
        glue compressor → saturator → air → low cut → limiter → ceiling → out
```

- The reverb impulse response is generated at runtime (sparse early
  reflections, then a decaying noise tail); the delay's feedback loop is
  low-passed so repeats darken rather than get shriller.
- The final ceiling is a `WaveShaper`, not a compressor: it clamps its input
  before the curve lookup, so output cannot exceed the curve's endpoint.
  Overshoot is arithmetically impossible, not merely unlikely.
- A note allocates only its own oscillators/gains and tears them down when it
  finishes. Polyphony is capped by counting sounding (not merely registered)
  voices; the oldest is stolen when the cap is reached.

Four ways to play a chart: **Bloom** assembles it into one chord, rising sign
first; **Scalar** walks the zodiac from the Ascendant with note length set by
modality; **Drone** sustains the anchors and surfaces other bodies at a rate
driven by aspect tightness; **Melodic** builds a tune from only the chart's
own notes, in whichever major/minor key they best fit, and loops it.

Temperament is switchable. Equal supports both pitch presentations
(Chromatic / Gliss); Just and Pythagorean instead quantise to the sign in
either presentation.

### Tone palettes

The synthesis is data. `palettes.js` holds one timbre table per element and
one gesture table per house; `voices.js` is the renderer that turns either
into a graph. A palette changes only the voices' timbre, not the chart, the
scheduler, the sign/house/modality mapping, or the master chain. Modalities
stay in `ontology.js`, since cardinal/fixed/mutable is a claim about
articulation independent of timbre.

Two palettes ship: **Warm** (`harmonic`, default) uses explicit overtone
series via `createPeriodicWave`, lower noise/drive, gentler movement, longer
releases. **Bright** (`astropitch`) uses built-in saw/square/triangle/sine
with denser spectra, more attack noise, more drive.

Two constraints are measured and tested:

- **Body ratios stay off the harmonic grid** (e.g. 2.7, 1.6, 4.2): a body is
  a fixed physical resonance, so an integer ratio would land the peaking
  filter on a partial already there and boost it by its full gain.
- **Sends are set against the master chain**, not corrected by turning a
  palette down: measured, a 30% cut in voice gain moved master RMS ~4%,
  while a 30% cut in send level moved it 8% and brought time above the
  soft-clip ceiling from +39% to +2%. `palettes.test.mjs` bounds the mean
  send so this can't drift again.

Adding a third palette is adding a table, not a dependency: wavetable,
resonant body, and FM operator are already in the renderer.

## Using it

The controls panel folds away against the left rail; state is remembered
between visits.

| Key | |
| --- | --- |
| `Space` | play the chart, or stop it |
| `B` `S` `D` `M` | bloom, scalar, drone, melodic |
| `[` | fold or unfold the controls |
| `]` | hide or show the player |
| `Esc` | cancel a designer drag, or close *How it works*/Settings |

## Run locally

ES modules need a real origin, so `file://` will not work:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open [http://localhost:8000](http://localhost:8000). Best with
headphones. `Ctrl+C` to stop.

## Tests

Plain Node, no `AudioContext`:

```sh
node tests/ephemeris.test.mjs    # astronomy vs. Meeus and JPL reference values
node tests/synastry.test.mjs     # cross-chart contacts, density, harmony score
node tests/performer.test.mjs    # what the arrangements schedule
node tests/designer.test.mjs     # hand-placed bodies, switches, moved angles
node tests/palettes.test.mjs     # every palette builds every combination
node tests/engine.test.mjs       # polyphony gain-staging arithmetic
node tests/mobile.test.mjs       # pinch/pan math, bottom-sheet state
node tests/ui-state.test.mjs     # overlay eligibility, audio-preference validation
```

Everything else needs a real `AudioContext` or DOM, and runs headless in Chrome:

```sh
node tests/run-browser.mjs tests/audio.test.html      # every sign x house x palette, OfflineAudioContext
node tests/run-browser.mjs tests/polyphony.test.html  # the same chain with a transport left running
node tests/run-browser.mjs tests/stability.test.html 180  # realtime AudioContext: underruns, dropped quanta, clock drift
node tests/run-browser.mjs tests/overlay.test.html
node tests/run-browser.mjs tests/audio-preferences.test.html
```

These measure level and distortion, not whether it sounds good; manual
listening is still required for audio changes.

## Layout

```
index.html
src/
  ontology.js        signs, houses, elements, modalities, bodies, aspects
  ephemeris.js       Sun, Moon, planets, angles, house systems
  chart.js           longitudes -> placements, aspects, balance, synastry, designer
  styles.css
  audio/
    engine.js        the persistent signal graph
    voices.js        timbre x gesture x articulation -> one voice
    palettes.js      the timbre and gesture tables the renderer reads
    tuning.js        longitude -> frequency, temperaments
    performer.js     bloom, scalar, drone, melodic
  ui/
    wheel.js         SVG chart wheel + circular oscilloscope
    app.js           wiring
    starfield.js
```
