# AstroPitch

AstroPitch turns a natal chart into sound: zodiac longitude maps to pitch, and
chart relationships become musical intervals.

No build step, no dependencies, no server, no API. Static files and the Web Audio
API.

## The idea

Each sign occupies a pitch region — Aries begins at A 432, Taurus at A♯,
Gemini at B, and so on up to Pisces at G♯. That is a chromatic scale wrapped
around a circle: twelve signs of 30° against twelve semitones.

```
30° of ecliptic longitude  ==  1 semitone
one trip around the zodiac ==  1 octave

frequency = A × 2^(longitude / 360)
```

So the conversion is arithmetic, not a lookup table, and it is *continuous*. A
planet at 14°22′ Aries is not "an A" — it is an A raised by 29 cents, and you can
hear the difference.

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

The tritone landing on the opposition is a happy accident. So is the major third
landing on the trine.

## What makes a placement sound the way it does

A placement is a stack of independent musical decisions. The sign supplies the
pitch region, element supplies the source material, house supplies the
performance gesture, modality supplies basic phrasing, and the planetary body
places the result in the ensemble. Aspects describe relationships between
placements; they do not replace either placement's instrument.

| Layer | Comes from | What it changes in sound |
|---|---|---|
| **Pitch** | Sign + exact degree | Fundamental pitch. In equal temperament, each degree raises it by 3⅓ cents; pitch-tracking filters and resonant body move with it. |
| **Material** | Element | Oscillator stack, harmonic density, noise, sub, resonance, spectral tilt, drift, and default space. |
| **Gesture** | House | Attack and filter contours, plus behavior such as gating, glide, doubling, or FM. |
| **Phrasing** | Modality | Base ADSR contour and vibrato amount, multiplied by the house gesture. |
| **Register / role** | Planetary body | Octave, gain, arrangement priority, and stereo position—not a separate timbre recipe. |
| **Relationship** | Aspects | The interval two placements form, and the importance or activity of that pairing. |

In brief: **the sign gives the note and its substance; the house gives that
substance a way of being played; the body says where it sits in the texture;
aspects say how it sounds with the other voices.**

### Sign, element, and modality

The sign is not a single preset. It supplies a pitch region, an element, and a
modality. In equal temperament, moving from 0° to 30° within a sign raises the
fundamental by a semitone. In Just and Pythagorean modes, AstroPitch
intentionally quantises to the sign pitch class, so degree no longer changes the
tuned fundamental.

| Element | Heard as | Synthesis material |
|---|---|---|
| **Fire** | bright, dense, urgent | Beating saws and square wave, sharp high-passed attack noise, soft clipping, bright tilt |
| **Earth** | weighty, wooden, contained | Triangles and sines over a strong sub, rolled-off upper partials, box resonance |
| **Air** | hollow, breathy, wide | Odd-rich pulse material, octave shadow, pitch-tracking band-passed breath, broad stereo image |
| **Water** | smooth, unstable, submerged | Detuned sine/triangle core, slow filter drift, low-index FM, long reverb tail |

| Modality | Heard as | Base phrasing |
|---|---|---|
| **Cardinal** | initiating | Near-instant onset, lower sustain, shorter decay |
| **Fixed** | held | Slower onset, high sustain, long release |
| **Mutable** | changing | Moderate onset and sustain, with the most base vibrato |

### House: the performance gesture

Houses act on the element's material; they do not replace it. A house can alter
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
same sign and house starts with the same element × house × modality instrument;
the body shifts its octave, changes its mix weight, and gives it a role. The Sun,
Moon, and Ascendant are the loudest anchors, while outer planets are more
atmospheric. Low bodies are also trimmed for headroom.

| Body | Register relative to the sign pitch | Role |
|---|---:|---|
| Ascendant / Sun | unshifted | outward voice / fundamental |
| Moon / Mars | one octave down | body beneath the tone / transient |
| Mercury / Uranus | one octave up | fast upper partial / interruption |
| Venus / Jupiter / Neptune | unshifted | consonance / expansion / wash |
| Saturn / Pluto | two octaves down | structural bass / underlying drone |

The Midheaven is displayed as an angle and target pitch, but does not sound as a
standalone voice.

### Example: Moon in Virgo, 3rd house vs. 4th house

Assume the same exact Virgo degree. Virgo is mutable Earth, so both placements
begin with the same D-region pitch, triangle/sine material, box resonance,
strong low end, and mutable movement. As the Moon, both are voiced one octave
down and given anchor-level prominence.

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

This yields 12 sign pitch/material combinations × 12 house gestures × 3 modal
phrasings, before body register and relationships are applied. These are
synthesized combinations, not samples.

## Chart inputs

Use **Birth data** to calculate a chart from a date, time, location, UTC offset,
and house system. Calculations run in the browser using the included
ephemeris — there is no external astrology API.

Use **Just the signs** when precise birth details are unavailable. Select each
body's sign manually; the app places it at 15° of that sign, which is the honest
position when the sign is all you know.

You must supply the UTC offset that was actually in force at the birth moment.
Historical daylight saving cannot be derived from coordinates, and guessing it
silently would be worse than asking.

Use **Designer** to build a chart by hand on top of whichever of those two you
cast. Drag any of the eleven sounding bodies around the wheel. Only the angular
position changes; a body stays on its ring however far the pointer wanders. Sign,
exact degree, house, pitch, element, modality and aspects are all recomputed as
it moves, so the chord you are looking at is the chord you will hear.

Each body also has a switch. A body switched off keeps its place on the wheel and
in the placement list, but drops out of the aspects, out of the elemental balance
and out of all three playback modes — the fastest way to find out what a chart
sounds like without its Saturn.

Moving the Ascendant turns the house ring with it, because the Ascendant *is* the
first cusp. Whole sign and equal houses are redrawn from the new angle; Placidus
and Porphyry have no closed form without the birth data behind them, so their
cusps rotate rigidly and keep their unequal spacing.

The design is stored separately from the cast chart, so *Reset to chart* always
has something to go back to, and nothing you drag ever edits the chart underneath.
Designing is one chart at a time: entering the designer clears any overlay, since
synastry puts two of everything on the wheel and cuts the sound density by contact.

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
  sustaining. A `WaveShaper` clamps its input before the curve lookup, so
  overshoot is arithmetically impossible rather than merely unlikely.
- A note allocates only its own oscillators and gains, and tears them down when
  it finishes. Polyphony is capped, counting sounding voices rather than
  registered ones, and the oldest is stolen when the cap is reached.

Three ways to play a chart: **Bloom** assembles it into one chord, rising sign
first; **Sequence** walks the zodiac from the Ascendant with note length set by
modality; **Drone** sustains the anchors and surfaces the other bodies at a rate
driven by how tightly they aspect each other.

Temperament is switchable. Equal keeps the mapping continuous; Just and
Pythagorean quantise to the sign, which is a different and audible claim about
what a sign is.

### Palettes

The synthesis is data. `palettes.js` holds one table of materials (per element)
and one of gestures (per house); `voices.js` is the renderer that turns either
into a graph. A palette changes what the voices are made of and nothing else —
not the chart, not the scheduler, not the sign/house/modality mapping, and not
the master chain. Modalities stay in `ontology.js`, because cardinal/fixed/mutable
is a claim about phrasing that holds whatever the timbre is.

Two ship, selectable in Settings:

- **AstroPitch** — the original. Subtractive and physical: saws pushed into soft
  clipping for fire, a wooden box for earth, a breath column for air, drifting
  sines for water.
- **Harmonic** — built so that whole charts blend. Partials specify their overtone
  series outright through `createPeriodicWave` rather than picking the nearest of
  the four built-in shapes, so amplitudes roll off smoothly, and noise and drive
  are nearly gone. Gestures keep their meanings — the 2nd is still struck, the
  5th still sings — with the extremes pulled in and the releases run longer.

Two things about a palette have to be measured rather than chosen, and both were
got wrong the first time here:

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
that its tables cover all four elements and all twelve houses, and that every
one of the 144 combinations builds a graph without sending a NaN — or a zero
into an exponential ramp — to an `AudioParam`. It stubs Web Audio, so it runs
in Node alongside the rest.

For the audio, open `tests/audio.test.html` with the server running. It renders
the graph through an `OfflineAudioContext` and measures the result: all 144
element × house combinations, for every palette, for NaN, clipping, hard cuts
and silence; envelope
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
    voices.js        material x gesture x phrasing -> one voice
    palettes.js      the material and gesture tables the renderer reads
    tuning.js        longitude -> frequency, temperaments
    performer.js     bloom, sequence, drone
  ui/
    wheel.js         SVG chart wheel + circular oscilloscope
    app.js           wiring
    starfield.js
```
