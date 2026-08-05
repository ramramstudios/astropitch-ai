# AstroPitch

AstroPitch is a browser-based astrological sonification system. Zodiac longitude
maps to pitch; chart structure controls timbre, articulation, register, and
relationships between notes.

This is the technical reference. It assumes familiarity with astrology, basic
music theory, and Web Audio concepts. The in-app **How it works** guide is the
shorter, astrology-first introduction.

No build step, dependencies, server, or API: static files and the Web Audio API.

## The idea

Each sign occupies a pitch region. Pitch presentation has two modes:
**Chromatic**, which locks a sign to one pitch, and **Gliss**, which moves
continuously through it. Temperament is a separate choice. In Equal
temperament, Chromatic maps Aries to A, Taurus to A♯, Gemini to B, and so on up
to Pisces at G♯; Gliss sets the center of Aries to the reference A (default =
432 hz). That is a chromatic scale wrapped around a circle: twelve signs of
30° against twelve semitones.

```
30° of ecliptic longitude  ==  1 semitone
one trip around the zodiac ==  1 octave

Gliss frequency = A × 2^((longitude - 15) / 360)
```

So the conversion is arithmetic, not a lookup table, and it is *continuous*.
The reference A sits dead-center in Aries; a planet at 14°22′ Aries is just
below that pitch center, and you can hear the difference.

The useful consequence is that **every aspect is an interval**, with no extra
assumptions:

| Aspect      | Angle | Semitones | Interval       |
|-------------|-------|-----------|----------------|
| Conjunction | 0°    | 0         | unison         |
| Sextile     | 60°   | 2         | major second   |
| Square      | 90°   | 3         | minor third    |
| Trine       | 120°  | 4         | major third    |
| Quincunx    | 150°  | 5         | perfect fourth |
| Opposition  | 180°  | 6         | tritone        |

The table uses the shortest, undirected distance between two placements, so it
ends at 180° / the tritone. The intervals beyond that point are inversions of
the ones already listed: for example, 210° is a perfect fifth, but it is the
same contact as a 150° quincunx heard in the opposite direction—a perfect
fourth. Listing both would duplicate the same aspect.

The clean interval landings are arithmetic, not accidental. The happy
coincidence is expressive: the opposition maps to a dissonant tritone and the
trine to a consonant major third, broadly echoing their traditional hard and
easy readings.

## What makes a placement sound the way it does

A placement is a stack of independent musical decisions. The sign supplies the
pitch region; its element supplies timbre, its modality supplies articulation,
and its house supplies the performance gesture. The planetary body places the
result in the ensemble. Aspects describe relationships between placements; they
do not replace either placement's instrument.

| Layer | Comes from | What it changes in sound |
|---|---|---|
| **Pitch** | Chromatic: sign; Gliss: sign + exact degree | Fundamental pitch. Chromatic locks each sign to one note in the twelve-tone chromatic system. In Gliss mode, each degree raises pitch by 3⅓ cents; pitch-tracking filters and resonant body move with it. |
| **Timbre** | Element | Oscillator stack, harmonic density, noise, sub, resonance, spectral tilt, drift, and default space. |
| **Gesture** | House | Attack and filter contours, plus behavior such as gating, glide, doubling, or FM. |
| **Articulation** | Modality | Base ADSR contour and vibrato depth, multiplied by the house gesture. |
| **Register / role** | Planetary body | Octave, gain, arrangement priority, and occasional body-level spatial treatment—not a separate timbre recipe. |
| **Relationship** | Aspects | The interval two placements form, and the importance or activity of that pairing. |

In brief: **the sign gives pitch, timbre, and articulation; the house gives
them a performance gesture; the body says where the voice sits in the texture;
aspects say how it sounds with the other voices.**

### Sign: pitch, timbre, and articulation

The sign is not a single preset. It supplies a pitch region, an element, and a
modality. Pitch presentation and temperament are separate controls:

- **Chromatic** locks a placement to its sign's pitch class.
- **Gliss** makes Equal temperament continuous: moving through a 30° sign
  raises the fundamental by a semitone.
- **Just** and **Pythagorean** are temperaments, not additional pitch modes.
  Both intentionally quantise to the sign pitch class, so degree no longer
  changes the tuned fundamental.

| Element → Timbre | Heard as | Timbre recipe |
|---|---|---|
| **Fire** | bright, dense, urgent | Beating saws and square wave, sharp high-passed attack noise, soft clipping, bright tilt |
| **Earth** | weighty, wooden, contained | Triangles and sines over a strong sub, rolled-off upper partials, box resonance |
| **Air** | hollow, breathy, wide | Odd-rich pulse spectrum, octave shadow, pitch-tracking band-passed breath, broad stereo image |
| **Water** | smooth, unstable, submerged | Detuned sine/triangle core, slow filter drift, low-index FM, long reverb tail |

| Modality → Articulation | Heard as | Base articulation |
|---|---|---|
| **Cardinal** | initiating | Near-instant onset, lower sustain, shorter decay |
| **Fixed** | held | Slower onset, high sustain, long release |
| **Mutable** | changing | Moderate onset and sustain, with the most base vibrato |

**Articulation changes expression, not the instrument:** modality multiplies
the house's amplitude envelope (attack, decay, sustain, and release) and sets
base vibrato depth. It does not change the oscillator spectrum, filters, noise,
FM, or spatial treatment.

### House: the performance gesture

Houses shape the element's timbre; they do not replace it. A house can alter
an envelope or filter, change noise or sub weight, widen the image, or add a
time-based behavior.

| House | Instruction | Audible result |
|---|---|---|
| 1st | Dry, immediate, narrow | Naked and forward |
| 2nd | Strike; more noise and sub; rapid decay | Physical, percussive mass |
| 3rd | Hard transient and brief 11 Hz flutter | Quick, articulate, speech-like attack |
| 4th | Slow, muffled onset; less noise, more sub | Warm, interior, heard through a wall |
| 5th | Pitch scoop and delayed vibrato | Sung, expressive, showy |
| 6th | Strict 8 Hz amplitude gate | Measured, clocked pulse |
| 7th | Delayed, panned 9-cent double | A paired voice, slightly apart |
| 8th | Extra sub and drive; slow filter opening | Growling and transforming over time |
| 9th | Slow contour, wide image, strong reverb/delay | Distant, expansive horizon |
| 10th | Filter overshoot and added drive | Brass-like, declarative projection |
| 11th | Inharmonic FM | Metallic, synthetic bell |
| 12th | Very long swell, glide, mostly reflected sound | Dissolved, pre-echoing arrival |

### Planetary body: register and orchestration

The body identifies the part in the ensemble. A Moon, Sun, or Mercury in the
same sign and house starts with the same Element → Timbre, House → Gesture, and
Modality → Articulation mapping; the body shifts its octave, changes its mix
weight, and gives it a role. The Sun and Moon are the loudest anchors, while
outer planets are more atmospheric. Low bodies are also trimmed
for headroom.

| Body | Register relative to the sign pitch | Role |
|---|---:|---|
| Ascendant / Sun | unshifted | outward voice / fundamental |
| Moon / Mars | one octave down | body beneath the tone / transient |
| Mercury / Uranus | one octave up | fast upper partial / interruption |
| Venus / Jupiter / Neptune | unshifted | consonance / expansion / wash |
| Saturn | two octaves down | structural bass |
| Pluto | one octave up | distant icy glint: quiet, wide, and reflected |

ASC and MC are directional references, not standalone sounding bodies, so they
default to off. DSC and IC are the same kind of reference — the opposite point
from MC and ASC respectively — but are not independently listed or switched;
they always mirror whichever of ASC/MC they are opposite.

### Example: Moon in Virgo, 3rd house vs. 4th house

Assume the same exact Virgo degree. Virgo is mutable Earth, so both placements
begin with the same D-region pitch, triangle/sine timbre, box resonance, strong
low end, and mutable articulation. As the Moon, both are voiced one octave down
and given anchor-level prominence.

| Same Moon in Virgo | House changes | Result |
|---|---|---|
| **3rd house** | Fast bright filter attack, doubled attack noise, short envelope, brief 11 Hz flutter, and extra delay | A low, wooden voice that speaks: tactile consonant, quick flutter, short decay |
| **4th house** | Slow attack, low filter starting point, less noise, reinforced sub, narrower stereo, little delay | A low, wooden voice heard inside a room: muffled, weighty, close, and warm |

Virgo remains Earth and the Moon remains low and prominent. The house changes
**articulation, spectral envelope, density, and space**—the same instrument is
made to speak or to settle into the room.

### Aspects: interval and interaction

An aspect does not overwrite either placement's timbre. It becomes audible when
the two placements are heard together: angular distance becomes an interval.
During the aspect audition, both bodies are temporarily brought to the same
octave, so the interval is literal rather than hidden by normal orchestration.

| Aspect | Angle | Interval | Playback meaning |
|---|---:|---|---|
| Conjunction | 0° | unison | Near pitches beat at a rate set by their orb; exact is fused |
| Sextile | 60° | major second | Close, stepwise two-note relation |
| Square | 90° | minor third | Compact, darker third |
| Trine | 120° | major third | Bright, stable third |
| Quincunx | 150° | perfect fourth | Open fourth |
| Opposition | 180° | tritone | The most unstable interval in this mapping |

Exactness affects importance rather than any individual oscillator setting:
exact contacts are ordered first, and in Drone mode bodies with tighter aspects
surface more often. In an overlay, the strongest eight cross-chart contacts
determine which bodies sound, so aspects also shape the texture's density.

This yields 12 distinct sign recipes × 12 house gestures = 144 combinations,
before body register and relationships are applied. Each sign recipe already
includes its element's timbre and its modality's articulation; modality is not
an additional independent factor. These are synthesized combinations, not
samples.

## Chart inputs

Use **Input** to calculate a chart from a date, time, location, UTC offset,
and house system. Calculations run in the browser using the included
ephemeris — there is no external astrology API.

Use **Basic** when precise birth details are unavailable. Select each
body's sign manually; the app places it at 15° of that sign, which is the honest
position when the sign is all you know.

You must supply the UTC offset that was actually in force at the birth moment.
Historical daylight saving cannot be derived from coordinates, and guessing it
silently would be worse than asking.

Use **Designer** to build a chart by hand on top of whichever of those two you
cast. Drag any of the ten planets around the wheel; only the angular position
changes, and a body stays on its ring however far the pointer wanders. Sign,
exact degree, house, pitch, element, modality and aspects are all recomputed as
it moves, so the chord you are looking at is the chord you will hear.

The four direction labels (ASC, MC, DSC, IC) work differently. Click one to
filter the wheel down to just its aspect network and hear it — this works in
any chart, not only in Designer. In Designer, press and drag one instead to
turn the whole sky: crossing the drag threshold hands off from that aspect
audition to the direction's own pitch preview, the same one a dragged planet
gets. Only the Ascendant is actually stored; MC, DSC and IC follow it. *Lock
bodies* decides whether the planets turn with the sky or hold their zodiac
position while the house ring turns under them.

Each body also has a switch, including ASC and MC (off by default — see
above). A body switched off keeps its place on the wheel and in the placement
list, but drops out of the aspects, out of the elemental balance and out of
all three playback modes — the fastest way to find out what a chart sounds
like without its Saturn.

Moving the Ascendant turns the house ring with it, because the Ascendant *is* the
first cusp. Whole sign houses snap to the new rising sign; equal houses redraw
from the exact angle; Placidus and Porphyry have no closed form without the
birth data behind them, so their cusps rotate rigidly and keep their unequal
spacing.

The design is stored separately from the cast chart, so *Reset to chart* always
has something to go back to, and nothing you drag ever edits the chart underneath.
Designing is one chart at a time: entering the designer clears any overlay, since
synastry puts two of everything on the wheel and cuts the sound density by contact.

The label above the wheel records the chart that is actually sounding rather than
the form currently being edited. Input, sky-now, random, basic, and designer
charts each identify themselves with their cast details. An overlay shortens this
to a one-line `chart × chart` or `chart × sky` label; the complete details remain
available as the label's tooltip.

## Two charts at once

The **Overlay** tab plays a chart against the sky right now, or against another
person's chart.

Neither chart is transposed. Both are tuned by the same rule, so they land in the
same chromatic octave and a contact between them is the interval it claims to be
— a cross-chart trine really is a major third. Shifting one chart aside to
"separate" the two would make every contact a lie.

That shared pitch space pays for itself. A cross-chart conjunction is a unison
held slightly apart, so its orb is directly audible as the rate at which the two
tones beat:

| orb | beat at A 432 | what you hear |
| --- | --- | --- |
| 8° | 6.8 Hz | roughness |
| 3° | 2.5 Hz | a tremble |
| 1° | 0.85 Hz | a slow swell |
| 0° | — | one fused tone |

What is controlled instead is density. Twenty-two bodies sounding at once is a
wall, but a relationship is not twenty-two bodies — it is the handful of places
where the two charts actually touch. Two charts throw around forty aspects
between them, so the strongest eight are kept and only the bodies involved in
those sound. In practice that is twelve or thirteen voices rather than
twenty-two. Bodies that touch nothing in the other chart are still drawn on the
wheel, dimmed, and listed as silent.

The cut is therefore made by the astrology rather than by a rule that says "only
ever play the Sun, Moon and Ascendant". A closely interlocked pair comes out
dense and busy; two strangers come out sparse and open. The texture is the
reading.

The **Bloom** arrangement pairs like bodies back to back — your Sun, then theirs
two tenths of a second later — so each contact arrives as an interval rather than
as two unrelated events. One number summarises the whole thing: the consonance of
the kept contacts, weighted by how tight each one is.

## The astronomy

- **Sun** — Meeus ch. 25. Matches the ch. 25 worked example to 0.001°.
- **Moon** — Meeus ch. 47, full 60-term longitude series with the eccentricity
  correction and the Venus/Jupiter additive terms. Matches example 47.a to five
  decimal places.
- **Planets** — JPL's approximate Keplerian elements with per-century rates,
  Kepler solved by Newton iteration, precessed to the equinox of date. Within
  0.32° of JPL Horizons across all eight.
- **Houses** — whole sign, equal, or Placidus by semi-arc division (iterating on
  each cusp's own ascensional difference), falling back to Porphyry inside the
  polar circles where Placidus has no solution.

Accurate enough for astrology, not for navigation.

## The audio engine

Raw Web Audio, no library. One signal graph is built once and reused for the life
of the page:

```
voices ─┬─────────────────────────────────────────────┐
        ├─ reverb send → pre-delay → IR → damping ────┤
        └─ delay send  → ping-pong → damped feedback ─┤
                                                      ▼
        glue compressor → saturator → tilt → limiter → ceiling → out
```

- The reverb impulse response is generated at runtime: sparse early reflections,
  then a noise tail whose brightness falls as it decays, with the two channels
  generated independently so the tail is genuinely wide.
- The delay's feedback loop is low-passed, so repeats get darker rather than
  shriller.
- The final ceiling is a `WaveShaper`, not a compressor. A limiter has a finite
  attack and lets fast transients through — measured at 1.012 with a full chart
  sustaining. A `WaveShaper` clamps its input before the curve lookup, so its
  output cannot exceed the curve's endpoint: overshoot is arithmetically
  impossible rather than merely unlikely.
- A note allocates only its own oscillators and gains, and tears them down when
  it finishes. Polyphony is capped, counting sounding voices rather than
  registered ones, and the oldest is stolen when the cap is reached.

Three ways to play a chart: **Bloom** assembles it into one chord, rising sign
first; **Sequence** walks the zodiac from the Ascendant with note length set by
modality; **Drone** sustains the anchors and surfaces the other bodies at a rate
driven by how tightly they aspect each other.

Temperament is switchable. Equal supports both pitch presentations: Chromatic
locks each sign to its place in the twelve-tone chromatic system, while Gliss
keeps the mapping continuous around the sign's pitch center. Just and
Pythagorean instead quantise to the sign in either presentation, which is a
different and audible claim about what a sign is.

### Tone palettes

The synthesis is data. `palettes.js` holds one timbre table per element and one
gesture table per house; `voices.js` is the renderer that turns either into a
graph. A palette changes the voices' timbre and nothing else — not the chart,
the scheduler, the sign/house/modality mapping, or the master chain. Modalities
stay in `ontology.js`, because cardinal/fixed/mutable is a claim about
articulation that holds whatever the timbre is.

Two palettes ship. **Warm** is the default and sits on the left of the Settings
switch; **Bright** is the right-hand alternative. The internal ids remain
`harmonic` and `astropitch` respectively.

- **Warm** (`harmonic`) uses explicit overtone series via `createPeriodicWave`,
  lower noise and drive, gentler filter/gate movement, and longer releases. It
  is intended to keep dense charts clear and blended.
- **Bright** (`astropitch`) uses built-in saw, square, triangle, and sine sources
  with denser spectra, more attack noise, more drive, and stronger gestures.

Two palette constraints are measured and tested:

- **Body ratios belong off the harmonic grid.** A body is a formant, a fixed
  physical resonance, so there is nothing for it to be consonant with. Set it to
  an integer ratio and the peaking filter lands on a partial that is already
  there and boosts it by its full gain. The original palette's 2.7, 1.6 and 4.2
  are deliberately between partials.
- **Sends have to be set against the master chain.** Smooth spectra are louder
  than rough ones at equal peak, and a reverb send returns sustained low-crest
  energy that raises RMS without raising peak. Because the chain normalises, a
  palette cannot be corrected by turning it down: measured, a 30% cut in voice
  gain moved master RMS about 4%, while a 30% cut in send level moved it 8% and
  brought time above the soft-clip ceiling from +39% to +2% against the original
  palette. `palettes.test.mjs` bounds the mean send so this cannot drift again.

Adding a third is adding a table. It is not adding a dependency: a wavetable, a
resonant body and an FM operator are all already in the renderer, and anything
they can't reach (a plucked string, say) is a small addition to the renderer
rather than a reason to take on an audio framework.

## Using it

The controls panel folds away against the left rail, which is worth doing once
you have cast the chart: the wheel takes the height it was already asking for,
and the readout moves into the space the panel left behind, so what you are
hovering and what it says about it are on screen together. The state is
remembered between visits.

| Key | |
| --- | --- |
| `Space` | play the chart, or stop it |
| `B` `S` `D` | bloom, sequence, drone |
| `[` | fold or unfold the controls |
| `]` | hide or show the player |
| `Esc` | cancel a designer drag, or close *How it works* |

## Run locally

This is a static HTML/CSS/JavaScript project, but ES modules need a real origin,
so `file://` will not work. Serve it with Python's built-in web server:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open [http://localhost:8000](http://localhost:8000) in a browser. Best with
headphones.

Stop the server with `Ctrl+C` in the terminal where it is running.

## Tests

```sh
node tests/ephemeris.test.mjs    # astronomy vs. Meeus and JPL reference values
node tests/synastry.test.mjs     # cross-chart contacts, density, harmony score
node tests/performer.test.mjs    # what the arrangements schedule
node tests/designer.test.mjs     # hand-placed bodies, switches, moved angles
node tests/palettes.test.mjs     # every palette builds every combination
```

`synastry.test.mjs` pins the claims the overlay depends on: that a merged
synastry object is shaped exactly like a chart, that neither chart is
transposed, and that orb converts to beat rate as advertised.
`performer.test.mjs` stubs voice construction so the arrangement logic can run
without an `AudioContext`; its sharpest check is that the detune nudge never
crosses between charts, since there the beating is the signal rather than
something to be smoothed away.
`designer.test.mjs` holds the designer to the same bargain as the overlay: a
designed chart has to be shaped exactly like a cast one, a moved body has to
carry every derived field with it, and a body switched off has to disappear from
the aspects, the balance and the schedule rather than merely being turned down.

`palettes.test.mjs` guards the thing a new palette is most likely to get wrong:
that its tables cover all four elements and twelve houses. It also exercises
the renderer with all three fixed modalities, so every one of the 144 element ×
modality × house combinations (equivalently, 12 sign recipes × 12 houses)
builds a graph without sending a NaN — or a zero into an exponential ramp — to
an `AudioParam`. It stubs Web Audio, so it runs in Node alongside the rest.

For the audio, open `tests/audio.test.html` with the server running. It renders
the graph through an `OfflineAudioContext` and measures the result: all 144
sign × house combinations, for every palette, for NaN, clipping, hard cuts and
silence; envelope
endpoints; a full eleven-voice bloom for headroom and DC offset; voice teardown
and polyphony capping; reverb and delay stability; and the tuning maths.

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
    performer.js     bloom, sequence, drone
  ui/
    wheel.js         SVG chart wheel + circular oscilloscope
    app.js           wiring
    starfield.js
```
